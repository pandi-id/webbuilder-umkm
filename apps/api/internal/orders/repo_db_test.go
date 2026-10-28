package orders

// Integration tests. Need TEST_DATABASE_URL; skipped otherwise.

import (
	"context"
	"errors"
	"os"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/webbuilder/api/internal/db"
)

var testPool *pgxpool.Pool

func TestMain(m *testing.M) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		os.Exit(m.Run())
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		panic("connect test db: " + err.Error())
	}
	defer pool.Close()
	if err := db.Migrate(ctx, pool, url); err != nil {
		panic("migrate test db: " + err.Error())
	}
	testPool = pool
	os.Exit(m.Run())
}

func needsDB(t *testing.T) *Repo {
	t.Helper()
	if testPool == nil {
		t.Skip("TEST_DATABASE_URL not set")
	}
	return NewRepo(testPool)
}

func makeSite(t *testing.T, ctx context.Context, status string) uuid.UUID {
	t.Helper()
	uid := uuid.New()
	if _, err := testPool.Exec(ctx,
		`INSERT INTO users (id, email, password_hash, name) VALUES ($1, $2, 'x', 'Order Test')`,
		uid, "orders-"+uid.String()+"@test.local"); err != nil {
		t.Fatalf("makeUser: %v", err)
	}
	sid := uuid.New()
	if _, err := testPool.Exec(ctx,
		`INSERT INTO sites (id, user_id, slug, name, status, whatsapp_number)
		 VALUES ($1, $2, $3, 'Toko Uji', $4, '6281234567890')`,
		sid, uid, "orders-"+sid.String()[:8], status); err != nil {
		t.Fatalf("makeSite: %v", err)
	}
	return sid
}

// makeProduct — stock nil = unlimited.
func makeProduct(t *testing.T, ctx context.Context, siteID uuid.UUID, slug string, price int64, stock *int) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	if err := testPool.QueryRow(ctx,
		`INSERT INTO products (site_id, slug, name, price, stock) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
		siteID, slug, "Produk "+slug, price, stock).Scan(&id); err != nil {
		t.Fatalf("makeProduct: %v", err)
	}
	return id
}

func stockOf(t *testing.T, ctx context.Context, id uuid.UUID) *int {
	t.Helper()
	var s *int
	if err := testPool.QueryRow(ctx, `SELECT stock FROM products WHERE id = $1`, id).Scan(&s); err != nil {
		t.Fatalf("stockOf: %v", err)
	}
	return s
}

func countOrders(t *testing.T, ctx context.Context, siteID uuid.UUID) int {
	t.Helper()
	var n int
	if err := testPool.QueryRow(ctx, `SELECT COUNT(*) FROM orders WHERE site_id = $1`, siteID).Scan(&n); err != nil {
		t.Fatalf("countOrders: %v", err)
	}
	return n
}

func intp(n int) *int { return &n }

func input(lines ...Line) CreateInput {
	return CreateInput{Lines: lines, CustomerName: "Budi", CustomerPhone: "6281234567890"}
}

func TestCreate_DecrementsStockAndSnapshots(t *testing.T) {
	r := needsDB(t)
	ctx := context.Background()
	site := makeSite(t, ctx, "published")
	kopi := makeProduct(t, ctx, site, "kopi", 15000, intp(10))
	teh := makeProduct(t, ctx, site, "teh", 8000, nil)

	res, err := r.Create(ctx, site, input(Line{"kopi", 3}, Line{"teh", 2}))
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	o := res.Order
	if o.Seq != 1 || o.OrderNo != "#0001" || o.Status != StatusNew {
		t.Errorf("order header = %+v", o)
	}
	if o.Total != 3*15000+2*8000 || o.Currency != "IDR" {
		t.Errorf("total = %d %s", o.Total, o.Currency)
	}
	if len(o.Items) != 2 || o.Items[0].Slug != "kopi" || o.Items[0].ProductID != kopi ||
		o.Items[0].Subtotal != 45000 || o.Items[1].Name != "Produk teh" {
		t.Errorf("items = %+v", o.Items)
	}
	if res.StoreName != "Toko Uji" || res.WhatsAppNumber != "6281234567890" {
		t.Errorf("store info = %+v", res)
	}
	if s := stockOf(t, ctx, kopi); s == nil || *s != 7 {
		t.Errorf("kopi stock = %v, want 7", s)
	}
	if s := stockOf(t, ctx, teh); s != nil {
		t.Errorf("unlimited stock must stay NULL, got %d", *s)
	}

	// Price snapshot survives later product edits.
	if _, err := testPool.Exec(ctx, `UPDATE products SET price = 99999, name = 'Baru' WHERE id = $1`, kopi); err != nil {
		t.Fatal(err)
	}
	got, err := r.GetByID(ctx, o.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Items[0].Price != 15000 || got.Items[0].Name != "Produk kopi" {
		t.Errorf("snapshot changed: %+v", got.Items[0])
	}
}

func TestCreate_OutOfStockRollsBackEverything(t *testing.T) {
	r := needsDB(t)
	ctx := context.Background()
	site := makeSite(t, ctx, "published")
	a := makeProduct(t, ctx, site, "a", 1000, intp(5))
	b := makeProduct(t, ctx, site, "b", 1000, intp(1))

	_, err := r.Create(ctx, site, input(Line{"a", 2}, Line{"b", 3}))
	var oos *OutOfStockError
	if !errors.As(err, &oos) || !errors.Is(err, ErrOutOfStock) {
		t.Fatalf("want OutOfStockError, got %v", err)
	}
	if oos.Name != "Produk b" || oos.Remaining != 1 {
		t.Errorf("oos = %+v", oos)
	}
	if s := stockOf(t, ctx, a); *s != 5 {
		t.Errorf("stock of a must be untouched, got %d", *s)
	}
	if s := stockOf(t, ctx, b); *s != 1 {
		t.Errorf("stock of b must be untouched, got %d", *s)
	}
	if n := countOrders(t, ctx, site); n != 0 {
		t.Errorf("no order row expected, got %d", n)
	}
}

func TestCreate_UnavailableAndUnpublished(t *testing.T) {
	r := needsDB(t)
	ctx := context.Background()
	site := makeSite(t, ctx, "published")
	draft := makeProduct(t, ctx, site, "draft-item", 1000, nil)
	if _, err := testPool.Exec(ctx, `UPDATE products SET status = 'draft' WHERE id = $1`, draft); err != nil {
		t.Fatal(err)
	}
	for _, slug := range []string{"missing", "draft-item"} {
		_, err := r.Create(ctx, site, input(Line{slug, 1}))
		var pu *ProductUnavailableError
		if !errors.As(err, &pu) || pu.Slug != slug {
			t.Errorf("%s: want ProductUnavailableError, got %v", slug, err)
		}
	}

	unpublished := makeSite(t, ctx, "draft")
	makeProduct(t, ctx, unpublished, "x", 1000, nil)
	if _, err := r.Create(ctx, unpublished, input(Line{"x", 1})); !errors.Is(err, ErrSiteNotFound) {
		t.Errorf("draft site: want ErrSiteNotFound, got %v", err)
	}
	if _, err := r.Create(ctx, uuid.New(), input(Line{"x", 1})); !errors.Is(err, ErrSiteNotFound) {
		t.Errorf("missing site: want ErrSiteNotFound, got %v", err)
	}
}

func TestCreate_ConcurrentDistinctSeq(t *testing.T) {
	r := needsDB(t)
	ctx := context.Background()
	site := makeSite(t, ctx, "published")
	p := makeProduct(t, ctx, site, "item", 500, intp(100))
	// A second product makes carts lock rows in different buyer orders.
	q := makeProduct(t, ctx, site, "other", 500, intp(100))

	const n = 12
	var wg sync.WaitGroup
	seqs := make(chan int, n)
	errs := make(chan error, n)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			lines := []Line{{"item", 1}, {"other", 1}}
			if i%2 == 0 {
				lines = []Line{{"other", 1}, {"item", 1}}
			}
			res, err := r.Create(ctx, site, input(lines...))
			if err != nil {
				errs <- err
				return
			}
			seqs <- res.Order.Seq
		}(i)
	}
	wg.Wait()
	close(seqs)
	close(errs)
	for err := range errs {
		t.Errorf("concurrent create: %v", err)
	}
	seen := map[int]bool{}
	for s := range seqs {
		if seen[s] {
			t.Errorf("duplicate seq %d", s)
		}
		seen[s] = true
	}
	for i := 1; i <= n; i++ {
		if !seen[i] {
			t.Errorf("missing seq %d", i)
		}
	}
	if s := stockOf(t, ctx, p); *s != 100-n {
		t.Errorf("stock = %d, want %d", *s, 100-n)
	}
	if s := stockOf(t, ctx, q); *s != 100-n {
		t.Errorf("other stock = %d, want %d", *s, 100-n)
	}
}

func TestUpdateStatus_CancelRestoresStock(t *testing.T) {
	r := needsDB(t)
	ctx := context.Background()
	site := makeSite(t, ctx, "published")
	limited := makeProduct(t, ctx, site, "limited", 1000, intp(4))
	unlimited := makeProduct(t, ctx, site, "unlimited", 1000, nil)
	gone := makeProduct(t, ctx, site, "gone", 1000, intp(9))

	res, err := r.Create(ctx, site, input(Line{"limited", 3}, Line{"unlimited", 2}, Line{"gone", 1}))
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if _, err := testPool.Exec(ctx, `DELETE FROM products WHERE id = $1`, gone); err != nil {
		t.Fatal(err)
	}

	o, from, err := r.UpdateStatus(ctx, res.Order.ID, StatusProcessing)
	if err != nil || from != StatusNew || o.Status != StatusProcessing {
		t.Fatalf("to processing: %v from=%s order=%+v", err, from, o)
	}
	o, _, err = r.UpdateStatus(ctx, res.Order.ID, StatusCancelled)
	if err != nil || o.Status != StatusCancelled {
		t.Fatalf("to cancelled: %v", err)
	}
	if s := stockOf(t, ctx, limited); *s != 4 {
		t.Errorf("limited stock = %d, want 4", *s)
	}
	if s := stockOf(t, ctx, unlimited); s != nil {
		t.Errorf("unlimited stock must stay NULL, got %d", *s)
	}
}

func TestUpdateStatus_TerminalRejected(t *testing.T) {
	r := needsDB(t)
	ctx := context.Background()
	site := makeSite(t, ctx, "published")
	p := makeProduct(t, ctx, site, "p", 1000, intp(10))

	done, err := r.Create(ctx, site, input(Line{"p", 1}))
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := r.UpdateStatus(ctx, done.Order.ID, StatusDone); err != nil {
		t.Fatalf("new -> done: %v", err)
	}
	_, from, err := r.UpdateStatus(ctx, done.Order.ID, StatusCancelled)
	if !errors.Is(err, ErrInvalidTransition) || from != StatusDone {
		t.Errorf("done -> cancelled: want ErrInvalidTransition, got %v (from=%s)", err, from)
	}
	if s := stockOf(t, ctx, p); *s != 9 {
		t.Errorf("rejected cancel must not restore stock, got %d", *s)
	}

	cancelled, err := r.Create(ctx, site, input(Line{"p", 2}))
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := r.UpdateStatus(ctx, cancelled.Order.ID, StatusCancelled); err != nil {
		t.Fatal(err)
	}
	for _, to := range []string{StatusProcessing, StatusDone, StatusCancelled} {
		if _, _, err := r.UpdateStatus(ctx, cancelled.Order.ID, to); !errors.Is(err, ErrInvalidTransition) {
			t.Errorf("cancelled -> %s: want ErrInvalidTransition, got %v", to, err)
		}
	}
	// Double cancel must not double-restore.
	if s := stockOf(t, ctx, p); *s != 9 {
		t.Errorf("stock = %d, want 9", *s)
	}
	if _, _, err := r.UpdateStatus(ctx, uuid.New(), StatusDone); !errors.Is(err, ErrNotFound) {
		t.Errorf("missing order: want ErrNotFound, got %v", err)
	}
}

func TestListAndSummary(t *testing.T) {
	r := needsDB(t)
	ctx := context.Background()
	site := makeSite(t, ctx, "published")
	makeProduct(t, ctx, site, "p", 1000, nil)

	mk := func(name, phone string, qty int) *Order {
		in := input(Line{"p", qty})
		in.CustomerName, in.CustomerPhone = name, phone
		res, err := r.Create(ctx, site, in)
		if err != nil {
			t.Fatal(err)
		}
		return res.Order
	}
	o1 := mk("Budi", "6281111111111", 1)
	o2 := mk("Siti", "6282222222222", 5)
	mk("Andi", "6283333333333", 2)
	if _, _, err := r.UpdateStatus(ctx, o2.ID, StatusDone); err != nil {
		t.Fatal(err)
	}

	list := func(q, status, sort string) []Order {
		f := searchFilter(q, "%"+q+"%")
		f.Status, f.Sort, f.Limit = status, sort, 20
		items, total, err := r.ListBySite(ctx, site, f)
		if err != nil {
			t.Fatalf("list: %v", err)
		}
		if total != len(items) {
			t.Errorf("total %d != len %d", total, len(items))
		}
		return items
	}
	if got := list("", "", ""); len(got) != 3 || got[0].Seq != 3 {
		t.Errorf("newest list = %d items, first seq %d", len(got), got[0].Seq)
	}
	if got := list("", "", "oldest"); got[0].ID != o1.ID {
		t.Error("oldest sort wrong")
	}
	if got := list("", "", "total_desc"); got[0].ID != o2.ID {
		t.Error("total_desc sort wrong")
	}
	if got := list("siti", "", ""); len(got) != 1 || got[0].ID != o2.ID {
		t.Errorf("name search = %+v", got)
	}
	if got := list("08333", "", ""); len(got) != 1 || got[0].CustomerName != "Andi" {
		t.Errorf("phone search = %+v", got)
	}
	if got := list("#1", "", ""); len(got) != 1 || got[0].ID != o1.ID {
		t.Errorf("seq search = %+v", got)
	}
	if got := list("", StatusDone, ""); len(got) != 1 || got[0].ID != o2.ID {
		t.Errorf("status filter = %+v", got)
	}

	s, err := r.SummaryBySite(ctx, site)
	if err != nil {
		t.Fatal(err)
	}
	if s.New != 2 || s.Done != 1 || s.Processing != 0 || s.Cancelled != 0 || s.RevenueDone != 5000 {
		t.Errorf("summary = %+v", s)
	}
}
