// Package seed centralises everything that gets inserted on startup or via a
// one-off command — built-in templates, admin bootstrap, and optional demo data.
//
// Idempotent: re-running a seed is always safe. Anything that should mutate
// only when a row is missing uses ON CONFLICT or pre-flight existence checks.
package seed

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/webbuilder/api/internal/auth"
	"github.com/webbuilder/api/internal/blog"
	"github.com/webbuilder/api/internal/pages"
	"github.com/webbuilder/api/internal/products"
	"github.com/webbuilder/api/internal/sites"
	"github.com/webbuilder/api/internal/templates"
)

// Deps bundles every repo the seeders need.
type Deps struct {
	Pool      *pgxpool.Pool
	Auth      *auth.Repo
	Templates *templates.Repo
	Sites     *sites.Repo
	Pages     *pages.Repo
	Products  *products.Repo
	Blog      *blog.Repo
}

// Options controls which seeders run.
type Options struct {
	// AdminEmail/Password — if both set, an admin user is upserted.
	AdminEmail    string
	AdminPassword string
	AdminName     string

	// Demo — when true, insert demo user + site + sample products + posts.
	// Idempotent: skipped if the demo user already exists.
	Demo         bool
	DemoEmail    string // default: demo@example.com
	DemoPassword string // default: demo1234
}

// Run executes every requested seed in order. Returns the first error.
func Run(ctx context.Context, d Deps, o Options) error {
	if err := Templates(ctx, d.Templates); err != nil {
		return fmt.Errorf("seed: templates: %w", err)
	}
	if err := Promos(ctx, d.Pool); err != nil {
		return fmt.Errorf("seed: promos: %w", err)
	}
	if o.AdminEmail != "" && o.AdminPassword != "" {
		if err := Admin(ctx, d.Auth, o.AdminEmail, o.AdminPassword, o.AdminName); err != nil {
			return fmt.Errorf("seed: admin: %w", err)
		}
	}
	if o.Demo {
		email := o.DemoEmail
		if email == "" {
			email = "demo@example.com"
		}
		pwd := o.DemoPassword
		if pwd == "" {
			pwd = "demo1234"
		}
		if err := Demo(ctx, d, email, pwd); err != nil {
			return fmt.Errorf("seed: demo: %w", err)
		}
	}
	return nil
}

// Promos — seed 1 demo promo `WELCOME10` (inactive by default). Idempotent
// via ON CONFLICT DO NOTHING. Operator aktifkan lewat admin panel kalau mau
// dipakai — atau edit dulu (nilai, TLD, expiry) sebelum aktif.
func Promos(ctx context.Context, pool *pgxpool.Pool) error {
	_, err := pool.Exec(ctx, `
		INSERT INTO promo_codes (code, description, discount_type, discount_value,
		    applies_to, allowed_tlds, min_subtotal, max_discount, max_uses_per_user, active)
		VALUES ('WELCOME10', 'Diskon selamat datang 10%%', 'percent', 10,
		        'register', '{}', 100000, 50000, 1, false)
		ON CONFLICT (code) DO NOTHING
	`)
	return err
}

// Templates re-upserts the built-in templates.
func Templates(ctx context.Context, r *templates.Repo) error {
	if err := r.Seed(ctx); err != nil {
		return err
	}
	slog.Info("seed: templates upserted", "count", len(templates.BuiltinTemplates()))
	return nil
}

// Admin upserts a user with role=admin. Password is only set on creation —
// re-running with the same email never overwrites the password.
func Admin(ctx context.Context, r *auth.Repo, email, password, name string) error {
	hash, err := auth.HashPassword(password)
	if err != nil {
		return err
	}
	if _, err := r.EnsureAdmin(ctx, email, hash, name); err != nil {
		return err
	}
	slog.Info("seed: admin user ensured", "email", email)
	return nil
}

// Demo creates one regular user with a UMKM site, 5 products, and 3 blog posts.
// Skips entirely if the user already exists.
func Demo(ctx context.Context, d Deps, email, password string) error {
	if u, err := d.Auth.GetByEmail(ctx, email); err == nil {
		slog.Info("seed: demo user already exists — skipping", "email", email, "id", u.ID)
		return nil
	} else if !errors.Is(err, auth.ErrNotFound) {
		return err
	}

	hash, err := auth.HashPassword(password)
	if err != nil {
		return err
	}
	u, err := d.Auth.CreateUser(ctx, email, hash, "Demo User")
	if err != nil {
		return fmt.Errorf("create user: %w", err)
	}

	// Create a site from the UMKM-modern template so blocks have content.
	tpl, err := d.Templates.GetBySlug(ctx, "umkm-modern")
	if err != nil {
		return fmt.Errorf("template lookup: %w", err)
	}
	tplID := tpl.ID
	site, err := d.Sites.Create(ctx, u.ID, "demo-toko", "Demo Toko Bahagia", &tplID, tpl.Theme)
	if err != nil {
		return fmt.Errorf("create site: %w", err)
	}

	// Provision template pages.
	var tplPages []demoPage
	_ = json.Unmarshal(tpl.Pages, &tplPages)
	for _, p := range tplPages {
		_, _ = d.Pages.Create(ctx, site.ID, p.Slug, p.Title, p.Tree, p.SEO, p.IsHome)
	}

	// Insert sample products.
	for _, p := range demoProducts {
		if _, err := d.Products.Create(ctx, site.ID, p); err != nil {
			return fmt.Errorf("create product %s: %w", p.Slug, err)
		}
	}

	// Insert sample blog posts (all published).
	for _, post := range demoBlogPosts {
		if _, err := d.Blog.Create(ctx, site.ID, post); err != nil {
			return fmt.Errorf("create post %s: %w", post.Slug, err)
		}
	}

	slog.Info("seed: demo provisioned",
		"email", email, "site_slug", site.Slug,
		"products", len(demoProducts), "blog_posts", len(demoBlogPosts))
	return nil
}

// --- Demo data ---

type demoPage struct {
	Slug   string          `json:"slug"`
	Title  string          `json:"title"`
	IsHome bool            `json:"is_home"`
	Tree   json.RawMessage `json:"tree"`
	SEO    json.RawMessage `json:"seo"`
}

var demoProducts = []products.CreateInput{
	{Slug: "keripik-singkong", Name: "Keripik Singkong Original", Description: "Renyah, gurih, bikin ketagihan. Bahan singkong pilihan dari petani lokal.", Price: 15000, Currency: "IDR", Category: "Snack", Status: "active"},
	{Slug: "kopi-bubuk-250g", Name: "Kopi Robusta Bubuk 250g", Description: "Single origin Lampung. Cocok untuk seduh manual brew atau espresso.", Price: 45000, Currency: "IDR", Category: "Minuman", Status: "active"},
	{Slug: "sambal-botol", Name: "Sambal Botol Pedas Manis", Description: "Sambal rumahan dengan cabai segar. Tanpa pengawet.", Price: 25000, Currency: "IDR", Category: "Bumbu", Status: "active"},
	{Slug: "teh-celup-premium", Name: "Teh Celup Premium 25 Sachet", Description: "Teh daun pilihan dari kebun Wonosobo.", Price: 18000, Currency: "IDR", Category: "Minuman", Status: "active"},
	{Slug: "madu-hutan-500ml", Name: "Madu Hutan Murni 500ml", Description: "Madu liar dari hutan Kalimantan. Tanpa campuran.", Price: 95000, Currency: "IDR", Category: "Kesehatan", Status: "active"},
}

var demoBlogPosts = []blog.CreateInput{
	{
		Slug:       "tips-memilih-kopi",
		Title:      "5 Tips Memilih Biji Kopi yang Cocok untuk Anda",
		Excerpt:    "Bingung mau coba kopi tapi tidak tahu mulai dari mana? Berikut panduan singkatnya.",
		AuthorName: "Admin Toko",
		Status:     "published",
		ContentMD: `# Memilih Biji Kopi

Kopi yang enak dimulai dari **biji yang segar**. Berikut hal yang perlu Anda perhatikan:

## 1. Lihat Tanggal Roasting
Idealnya kopi dikonsumsi dalam **2-4 minggu** setelah roasting. Lewat dari itu, aroma mulai hilang.

## 2. Pilih Profil Sesuai Selera
- **Arabika** — asam, fruity, kompleks
- **Robusta** — pahit, full body, kafein tinggi

## 3. Single Origin vs Blend
Single origin menonjolkan karakter satu daerah. Blend memberikan rasa lebih balance.

> "The morning cup of coffee has an exhilaration about it which the cheering influence of the afternoon tea cannot be expected to reproduce." — Oliver Wendell Holmes`,
	},
	{
		Slug:       "cara-seduh-kopi-v60",
		Title:      "Cara Seduh Kopi V60 untuk Pemula",
		Excerpt:    "Panduan langkah demi langkah menyeduh manual brew V60 dengan alat sederhana.",
		AuthorName: "Admin Toko",
		Status:     "published",
		ContentMD: `# Seduh V60

Alat yang dibutuhkan:

1. Dripper V60
2. Filter paper
3. Gooseneck kettle (atau panci kecil yang bisa kontrol)
4. Timbangan
5. 15g kopi bubuk medium

## Langkah

1. Bilas filter paper dengan air panas, lalu buang airnya
2. Masukkan 15g bubuk kopi
3. **Bloom**: tuang 30g air, tunggu 30 detik
4. Tuang air melingkar perlahan sampai 250g total
5. Selesai dalam ~3 menit

Selamat mencoba!`,
	},
	{
		Slug:       "kenapa-umkm-perlu-website",
		Title:      "Kenapa UMKM Perlu Punya Website Sendiri",
		Excerpt:    "Mengandalkan marketplace saja tidak cukup. Berikut alasan mengapa website pribadi penting untuk UMKM.",
		AuthorName: "Admin Toko",
		Status:     "published",
		ContentMD: `# UMKM dan Website

Banyak UMKM masih ragu untuk punya website. Padahal manfaatnya banyak:

## 1. Branding Lebih Kuat
Website pribadi = identitas pribadi. Customer ingat **nama Anda**, bukan nama marketplace.

## 2. Bebas Biaya Komisi
Setiap transaksi di marketplace dipotong komisi. Di website sendiri, **Anda terima 100%**.

## 3. Data Customer Milik Sendiri
Email, preferensi, riwayat pesanan — semua data ada di tangan Anda untuk follow-up.

## 4. SEO untuk Long-term Growth
Konten dan produk Anda terindeks Google. Orang bisa nemu toko Anda tanpa iklan berbayar.`,
	},
}

// silence unused (helps IDE during partial refactor)
var _ = uuid.Nil
