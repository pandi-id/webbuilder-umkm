package products

// Integration tests. Need TEST_DATABASE_URL; skipped otherwise.

import (
	"context"
	"encoding/json"
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
		`INSERT INTO users (id, email, password_hash, name) VALUES ($1, $2, 'x', 'Product Test')`,
		uid, "products-"+uid.String()+"@test.local"); err != nil {
		t.Fatalf("makeUser: %v", err)
	}
	sid := uuid.New()
	if _, err := testPool.Exec(ctx,
		`INSERT INTO sites (id, user_id, slug, name, status) VALUES ($1, $2, $3, 'Toko Uji', 'published')`,
		sid, uid, "products-"+sid.String()[:8]); err != nil {
		t.Fatalf("makeSite: %v", err)
	}
	return sid
}

func strp(s string) *string { return &s }
func intp(n int) *int       { return &n }
func i64p(n int64) *int64   { return &n }

// Regression: a finite stock value used to be appended before the other
// arguments while the SET list hard-coded $2..$11, so every column after it
// read the wrong value — slug received the stock integer and Postgres rejected
// the statement. Editing any product that had a stock number returned 500.
func TestUpdate_WithFiniteStock_DoesNotShiftColumns(t *testing.T) {
	repo := needsDB(t)
	ctx := context.Background()
	site := makeSite(t, ctx)

	p, err := repo.Create(ctx, site, CreateInput{
		Slug: "keripik-lama", Name: "Keripik Lama", Price: 10000, Stock: intp(7),
		Description: "lama", Category: "Snack",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	got, err := repo.Update(ctx, p.ID, UpdateInput{
		Name:        strp("Keripik Baru"),
		Slug:        strp("keripik-baru"),
		Description: strp("deskripsi baru"),
		Price:       i64p(12500),
		Stock:       intp(5),
		ImageURL:    strp("https://cdn.test/a.jpg"),
		Category:    strp("Camilan"),
		Status:      strp("draft"),
	})
	if err != nil {
		t.Fatalf("update with finite stock: %v", err)
	}

	// Every field must land in its own column.
	if got.Slug != "keripik-baru" {
		t.Errorf("slug = %q, want keripik-baru", got.Slug)
	}
	if got.Name != "Keripik Baru" {
		t.Errorf("name = %q, want Keripik Baru", got.Name)
	}
	if got.Description != "deskripsi baru" {
		t.Errorf("description = %q", got.Description)
	}
	if got.Price != 12500 {
		t.Errorf("price = %d, want 12500", got.Price)
	}
	if got.Stock == nil || *got.Stock != 5 {
		t.Errorf("stock = %v, want 5", got.Stock)
	}
	if got.ImageURL != "https://cdn.test/a.jpg" {
		t.Errorf("image_url = %q", got.ImageURL)
	}
	if got.Category != "Camilan" {
		t.Errorf("category = %q, want Camilan", got.Category)
	}
	if got.Status != "draft" {
		t.Errorf("status = %q, want draft", got.Status)
	}
}

func TestUpdate_StockModes(t *testing.T) {
	repo := needsDB(t)
	ctx := context.Background()
	site := makeSite(t, ctx)

	p, err := repo.Create(ctx, site, CreateInput{Slug: "stok", Name: "Stok", Price: 1000, Stock: intp(3)})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	// Untouched: stock survives an edit that does not mention it.
	got, err := repo.Update(ctx, p.ID, UpdateInput{Name: strp("Stok v2")})
	if err != nil {
		t.Fatalf("update untouched: %v", err)
	}
	if got.Stock == nil || *got.Stock != 3 {
		t.Errorf("stock = %v after an unrelated edit, want 3", got.Stock)
	}

	// ClearStock wins over a stale Stock value in the same payload.
	got, err = repo.Update(ctx, p.ID, UpdateInput{Stock: intp(9), ClearStock: true})
	if err != nil {
		t.Fatalf("update clear: %v", err)
	}
	if got.Stock != nil {
		t.Errorf("stock = %v, want nil (unlimited)", got.Stock)
	}

	// And back to a number.
	got, err = repo.Update(ctx, p.ID, UpdateInput{Stock: intp(12)})
	if err != nil {
		t.Fatalf("update set: %v", err)
	}
	if got.Stock == nil || *got.Stock != 12 {
		t.Errorf("stock = %v, want 12", got.Stock)
	}
}

func TestUpdate_PartialKeepsUntouchedColumns(t *testing.T) {
	repo := needsDB(t)
	ctx := context.Background()
	site := makeSite(t, ctx)

	p, err := repo.Create(ctx, site, CreateInput{
		Slug: "parsial", Name: "Parsial", Price: 5000, Category: "Awal",
		Description: "awal", ImageURL: "https://cdn.test/old.jpg",
		Gallery: json.RawMessage(`["https://cdn.test/g1.jpg"]`),
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	got, err := repo.Update(ctx, p.ID, UpdateInput{Price: i64p(7500)})
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if got.Price != 7500 {
		t.Errorf("price = %d, want 7500", got.Price)
	}
	if got.Name != "Parsial" || got.Category != "Awal" || got.Description != "awal" {
		t.Errorf("unrelated columns changed: %+v", got)
	}
	if got.ImageURL != "https://cdn.test/old.jpg" {
		t.Errorf("image_url = %q, want unchanged", got.ImageURL)
	}
	if string(got.Gallery) != `["https://cdn.test/g1.jpg"]` {
		t.Errorf("gallery = %s, want unchanged", got.Gallery)
	}
}

func TestUpdate_SlugConflictReturnsSentinel(t *testing.T) {
	repo := needsDB(t)
	ctx := context.Background()
	site := makeSite(t, ctx)

	if _, err := repo.Create(ctx, site, CreateInput{Slug: "dipakai", Name: "A", Price: 1}); err != nil {
		t.Fatalf("create a: %v", err)
	}
	b, err := repo.Create(ctx, site, CreateInput{Slug: "bebas", Name: "B", Price: 1, Stock: intp(2)})
	if err != nil {
		t.Fatalf("create b: %v", err)
	}

	// With a stock argument in play too, so the conflict path is exercised on
	// the dynamic branch rather than only the simple one.
	if _, err := repo.Update(ctx, b.ID, UpdateInput{Slug: strp("dipakai"), Stock: intp(4)}); err != ErrSlugTaken {
		t.Errorf("err = %v, want ErrSlugTaken", err)
	}
}
