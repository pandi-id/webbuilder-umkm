package reviews

// Integration tests. Need TEST_DATABASE_URL; skipped otherwise.

import (
	"context"
	"errors"
	"os"
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

func makeSite(t *testing.T, ctx context.Context) uuid.UUID {
	t.Helper()
	uid := uuid.New()
	if _, err := testPool.Exec(ctx,
		`INSERT INTO users (id, email, password_hash, name) VALUES ($1, $2, 'x', 'Review Test')`,
		uid, "reviews-"+uid.String()+"@test.local"); err != nil {
		t.Fatalf("makeUser: %v", err)
	}
	sid := uuid.New()
	if _, err := testPool.Exec(ctx,
		`INSERT INTO sites (id, user_id, slug, name, status) VALUES ($1, $2, $3, 'Toko Uji', 'published')`,
		sid, uid, "reviews-"+sid.String()[:8]); err != nil {
		t.Fatalf("makeSite: %v", err)
	}
	return sid
}

func makeProduct(t *testing.T, ctx context.Context, siteID uuid.UUID, slug, status string) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	if err := testPool.QueryRow(ctx,
		`INSERT INTO products (site_id, slug, name, price, status) VALUES ($1, $2, $3, 10000, $4) RETURNING id`,
		siteID, slug, "Produk "+slug, status).Scan(&id); err != nil {
		t.Fatalf("makeProduct: %v", err)
	}
	return id
}

func makeOrder(t *testing.T, ctx context.Context, siteID uuid.UUID, phone, status string) {
	t.Helper()
	if _, err := testPool.Exec(ctx,
		`INSERT INTO orders (site_id, seq, status, customer_name, customer_phone, items_json, total)
		 VALUES ($1, (SELECT COALESCE(MAX(seq),0)+1 FROM orders WHERE site_id = $1), $2, 'Budi', $3, '[]'::jsonb, 10000)`,
		siteID, status, phone); err != nil {
		t.Fatalf("makeOrder: %v", err)
	}
}

func input(rating int, name string) CreateInput {
	return CreateInput{Rating: rating, AuthorName: name, Body: "Enak sekali"}
}

func TestCreateForSlug_StartsPendingAndStaysHidden(t *testing.T) {
	repo := needsDB(t)
	ctx := context.Background()
	site := makeSite(t, ctx)
	makeProduct(t, ctx, site, "keripik", "active")

	rv, err := repo.CreateForSlug(ctx, site, "keripik", input(5, "Siti"))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if rv.Status != StatusPending {
		t.Fatalf("status = %q, want %q", rv.Status, StatusPending)
	}
	if rv.VerifiedBuyer {
		t.Error("verified_buyer = true for a submission with no phone")
	}

	// A pending review must not reach the storefront, nor move the average.
	items, summary, err := repo.ListPublished(ctx, site, "keripik", 20)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(items) != 0 {
		t.Errorf("published list returned %d pending review(s)", len(items))
	}
	if summary.Count != 0 || summary.Average != 0 {
		t.Errorf("summary = %+v, want zero while unapproved", summary)
	}
	if summary.Breakdown != [5]int{} {
		t.Errorf("breakdown = %v, want all zero while unapproved", summary.Breakdown)
	}
}

func TestCreateForSlug_RejectsUnknownAndInactiveProducts(t *testing.T) {
	repo := needsDB(t)
	ctx := context.Background()
	site := makeSite(t, ctx)
	makeProduct(t, ctx, site, "draft-item", "draft")

	for _, slug := range []string{"tidak-ada", "draft-item"} {
		if _, err := repo.CreateForSlug(ctx, site, slug, input(4, "Budi")); !errors.Is(err, ErrProductUnavailable) {
			t.Errorf("slug %q: err = %v, want ErrProductUnavailable", slug, err)
		}
	}
}

func TestCreateForSlug_VerifiedBuyerFromOrderPhone(t *testing.T) {
	repo := needsDB(t)
	ctx := context.Background()
	site := makeSite(t, ctx)
	makeProduct(t, ctx, site, "sambal", "active")
	makeOrder(t, ctx, site, "6281234567890", "done")

	in := input(5, "Siti")
	in.AuthorPhone = "6281234567890"
	rv, err := repo.CreateForSlug(ctx, site, "sambal", in)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if !rv.VerifiedBuyer {
		t.Error("verified_buyer = false for a phone that has an order in this shop")
	}

	// A cancelled order is not a purchase.
	site2 := makeSite(t, ctx)
	makeProduct(t, ctx, site2, "sambal", "active")
	makeOrder(t, ctx, site2, "6289999999999", "cancelled")
	in2 := input(5, "Andi")
	in2.AuthorPhone = "6289999999999"
	rv2, err := repo.CreateForSlug(ctx, site2, "sambal", in2)
	if err != nil {
		t.Fatalf("create 2: %v", err)
	}
	if rv2.VerifiedBuyer {
		t.Error("verified_buyer = true off a cancelled order")
	}
}

func TestVerifiedBuyer_IsScopedToTheShop(t *testing.T) {
	repo := needsDB(t)
	ctx := context.Background()
	shopA := makeSite(t, ctx)
	shopB := makeSite(t, ctx)
	makeProduct(t, ctx, shopB, "kopi", "active")
	makeOrder(t, ctx, shopA, "6281111111111", "done") // bought from A, reviewing B

	in := input(5, "Rina")
	in.AuthorPhone = "6281111111111"
	rv, err := repo.CreateForSlug(ctx, shopB, "kopi", in)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if rv.VerifiedBuyer {
		t.Error("verified_buyer = true from an order placed at a different shop")
	}
}

func TestUpdate_PublishThenSummaryAndReply(t *testing.T) {
	repo := needsDB(t)
	ctx := context.Background()
	site := makeSite(t, ctx)
	makeProduct(t, ctx, site, "bakso", "active")

	five, err := repo.CreateForSlug(ctx, site, "bakso", input(5, "Siti"))
	if err != nil {
		t.Fatalf("create 5: %v", err)
	}
	four, err := repo.CreateForSlug(ctx, site, "bakso", input(4, "Budi"))
	if err != nil {
		t.Fatalf("create 4: %v", err)
	}

	pub := StatusPublished
	for _, id := range []uuid.UUID{five.ID, four.ID} {
		if _, err := repo.Update(ctx, id, site, UpdateInput{Status: &pub}); err != nil {
			t.Fatalf("publish %s: %v", id, err)
		}
	}

	items, summary, err := repo.ListPublished(ctx, site, "bakso", 20)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(items) != 2 {
		t.Fatalf("items = %d, want 2", len(items))
	}
	if summary.Count != 2 || summary.Average != 4.5 {
		t.Errorf("summary = %+v, want average 4.5 over 2 reviews", summary)
	}
	// Breakdown is indexed 1★..5★ and must agree with Count.
	if summary.Breakdown != [5]int{0, 0, 0, 1, 1} {
		t.Errorf("breakdown = %v, want [0 0 0 1 1]", summary.Breakdown)
	}

	// Replying stamps replied_at; clearing the reply clears the stamp again so
	// the UI never shows a timestamp with no text under it.
	reply := "Terima kasih!"
	withReply, err := repo.Update(ctx, five.ID, site, UpdateInput{Reply: &reply})
	if err != nil {
		t.Fatalf("reply: %v", err)
	}
	if withReply.Reply != reply || withReply.RepliedAt == nil {
		t.Fatalf("reply = %q, replied_at = %v", withReply.Reply, withReply.RepliedAt)
	}
	empty := ""
	cleared, err := repo.Update(ctx, five.ID, site, UpdateInput{Reply: &empty})
	if err != nil {
		t.Fatalf("clear reply: %v", err)
	}
	if cleared.RepliedAt != nil {
		t.Errorf("replied_at = %v after clearing the reply, want nil", cleared.RepliedAt)
	}
}

func TestUpdateAndDelete_ScopedBySite(t *testing.T) {
	repo := needsDB(t)
	ctx := context.Background()
	site := makeSite(t, ctx)
	other := makeSite(t, ctx)
	makeProduct(t, ctx, site, "tahu", "active")

	rv, err := repo.CreateForSlug(ctx, site, "tahu", input(3, "Doni"))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	// Another shop must not be able to moderate or delete this review.
	pub := StatusPublished
	if _, err := repo.Update(ctx, rv.ID, other, UpdateInput{Status: &pub}); !errors.Is(err, ErrNotFound) {
		t.Errorf("cross-site update err = %v, want ErrNotFound", err)
	}
	if err := repo.Delete(ctx, rv.ID, other); !errors.Is(err, ErrNotFound) {
		t.Errorf("cross-site delete err = %v, want ErrNotFound", err)
	}
	if err := repo.Delete(ctx, rv.ID, site); err != nil {
		t.Errorf("owner delete: %v", err)
	}
}

func TestCountByStatus_AndListPageFilter(t *testing.T) {
	repo := needsDB(t)
	ctx := context.Background()
	site := makeSite(t, ctx)
	makeProduct(t, ctx, site, "mie", "active")

	for i := 0; i < 3; i++ {
		if _, err := repo.CreateForSlug(ctx, site, "mie", input(5, "Pembeli")); err != nil {
			t.Fatalf("create %d: %v", i, err)
		}
	}
	n, err := repo.CountByStatus(ctx, site, StatusPending)
	if err != nil {
		t.Fatalf("count: %v", err)
	}
	if n != 3 {
		t.Fatalf("pending count = %d, want 3", n)
	}

	items, total, err := repo.ListPage(ctx, site, "%", StatusPending, "newest", 10, 0)
	if err != nil {
		t.Fatalf("list page: %v", err)
	}
	if total != 3 || len(items) != 3 {
		t.Fatalf("total = %d, items = %d, want 3/3", total, len(items))
	}
	// The inbox joins the product so the owner sees what was reviewed.
	if items[0].ProductName == "" || items[0].ProductSlug != "mie" {
		t.Errorf("product join missing: name=%q slug=%q", items[0].ProductName, items[0].ProductSlug)
	}

	if _, total, err = repo.ListPage(ctx, site, "%", StatusPublished, "newest", 10, 0); err != nil {
		t.Fatalf("list published: %v", err)
	} else if total != 0 {
		t.Errorf("published total = %d, want 0", total)
	}
}
