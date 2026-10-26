package templates

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"regexp"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/webbuilder/api/internal/auth"
	"github.com/webbuilder/api/internal/blog"
	"github.com/webbuilder/api/internal/domain_purchase"
	"github.com/webbuilder/api/internal/httpx"
	"github.com/webbuilder/api/internal/pages"
	"github.com/webbuilder/api/internal/products"
	"github.com/webbuilder/api/internal/sites"
)

type Handler struct {
	repo      *Repo
	sites     *sites.Repo
	pages     *pages.Repo
	products  *products.Repo        // optional — for seeding sample products on UMKM templates
	blog      *blog.Repo            // optional — for seeding sample blog posts on Blog templates
	purchases *domain_purchase.Repo // required in production — enforces "1 domain = 1 site"
}

func NewHandler(repo *Repo, s *sites.Repo, p *pages.Repo, pr *products.Repo, b *blog.Repo, dp *domain_purchase.Repo) *Handler {
	return &Handler{repo: repo, sites: s, pages: p, products: pr, blog: b, purchases: dp}
}

func (h *Handler) List(c *fiber.Ctx) error {
	out, err := h.repo.List(c.Context())
	if err != nil {
		return httpx.Internal(c, "list failed")
	}
	return httpx.OK(c, out)
}

// GET /api/v1/template-meta — returns category + variant lookup tables for the picker UI.
func (h *Handler) Meta(c *fiber.Ctx) error {
	return httpx.OK(c, fiber.Map{
		"categories": Categories,
		"variants":   Variants,
	})
}

func (h *Handler) Get(c *fiber.Ctx) error {
	t, err := h.repo.GetBySlug(c.Context(), c.Params("slug"))
	if errors.Is(err, ErrNotFound) {
		return httpx.NotFound(c, "template not found")
	}
	if err != nil {
		return httpx.Internal(c, "load failed")
	}
	return httpx.OK(c, t)
}

type createFromTemplateReq struct {
	Slug string `json:"slug"`
	Name string `json:"name"`
	// JobID = registrar_job_id dari domain purchase yang statusnya active
	// dan belum di-attach ke site lain. Wajib — tanpa domain, user tidak
	// bisa buat situs (1 domain = 1 site).
	JobID string `json:"job_id"`
}

type applyTemplateReq struct {
	Slug string    `json:"slug"`
	Mode ApplyMode `json:"mode"`
}

// POST /api/v1/sites/:id/apply-template
// body: { slug, mode: "theme" | "append" | "replace" }
func (h *Handler) ApplyToSite(c *fiber.Ctx) error {
	uid := auth.UserIDFrom(c)
	siteID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return httpx.BadRequest(c, "invalid site id")
	}
	if _, err := h.sites.GetOwned(c.Context(), siteID, uid); err != nil {
		return httpx.NotFound(c, "site not found")
	}

	var req applyTemplateReq
	if err := c.BodyParser(&req); err != nil {
		return httpx.BadRequest(c, "invalid json")
	}
	if req.Slug == "" {
		return httpx.BadRequest(c, "slug required")
	}
	switch req.Mode {
	case ApplyModeTheme, ApplyModeAppend, ApplyModeReplace:
	default:
		return httpx.BadRequest(c, "mode must be one of: theme, append, replace")
	}

	res, err := h.repo.ApplyToSite(c.Context(), siteID, req.Slug, req.Mode)
	if errors.Is(err, ErrNotFound) {
		return httpx.NotFound(c, "template not found")
	}
	if err != nil {
		return httpx.Internal(c, "apply failed: "+err.Error())
	}
	return httpx.OK(c, res)
}

var slugRe = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$`)

// POST /sites/from-template/:slug   { slug, name, job_id }
//
// Business rules:
//   - `job_id` WAJIB. Site cuma bisa dibuat kalau user sudah beli domain
//     (status=active, milik user, belum di-attach ke site lain).
//   - 1 domain = 1 site. Setelah create, purchase di-attach ke site baru;
//     purchase yang sudah di-attach tidak bisa dipakai untuk site kedua.
//
// Seeds setelah site jadi:
//  1. Pages from template (always)
//  2. Sample products if template category = "umkm"
//  3. Sample blog posts if template category = "blog"
//
// Sample seeding best-effort — errors di-log tapi tidak fail request.
func (h *Handler) CreateSiteFromTemplate(c *fiber.Ctx) error {
	uid := auth.UserIDFrom(c)
	tplSlug := c.Params("slug")
	tpl, err := h.repo.GetBySlug(c.Context(), tplSlug)
	if errors.Is(err, ErrNotFound) {
		return httpx.NotFound(c, "template not found")
	}
	if err != nil {
		return httpx.Internal(c, "load failed")
	}

	var req createFromTemplateReq
	if err := c.BodyParser(&req); err != nil {
		return httpx.BadRequest(c, "invalid json")
	}
	req.Slug = strings.ToLower(strings.TrimSpace(req.Slug))
	req.Name = strings.TrimSpace(req.Name)
	req.JobID = strings.TrimSpace(req.JobID)
	if req.Name == "" {
		req.Name = tpl.Name
	}
	// Slug opsional — auto-generate dari name kalau kosong (subdomain fallback
	// sudah dihapus, slug hanya internal identifier + export folder naming).
	if req.Slug != "" && !slugRe.MatchString(req.Slug) {
		return httpx.BadRequest(c, "slug format tidak valid (huruf kecil, angka, hyphen, 2-40 char)")
	}
	if req.Slug == "" {
		req.Slug = sites.Slugify(req.Name)
	}

	// Enforce "must own an active, unattached domain purchase" — sesuai
	// keputusan produk: user hanya boleh buat situs kalau sudah beli domain.
	if h.purchases == nil {
		return httpx.Err(c, fiber.StatusServiceUnavailable, "purchases_disabled",
			"Fitur beli domain belum dikonfigurasi di server (API_REGISTRY_URL kosong).")
	}
	if req.JobID == "" {
		return httpx.Err(c, fiber.StatusBadRequest, "job_id_required",
			"Domain wajib. Beli domain dulu lewat halaman 'Beli Domain + Buat Situs'.")
	}
	// Actor-inclusive lookup — reseller/agent yang beli on-behalf-of tetap
	// boleh trigger create-site flow untuk klien mereka.
	purchase, err := h.purchases.GetByJobIDForActor(c.Context(), req.JobID, uid)
	if errors.Is(err, domain_purchase.ErrNotFound) {
		return httpx.NotFound(c, "domain purchase tidak ditemukan atau bukan milik Anda")
	}
	if err != nil {
		return httpx.Internal(c, "purchase lookup failed")
	}
	if purchase.Status != domain_purchase.StatusActive {
		return httpx.Err(c, fiber.StatusBadRequest, "domain_not_active",
			"Domain belum aktif — status: "+purchase.Status+". Tunggu sampai domain aktif sebelum buat situs.")
	}
	if purchase.SiteID != nil {
		return httpx.Err(c, fiber.StatusConflict, "domain_already_attached",
			"Domain sudah dipakai untuk situs lain. 1 domain = 1 situs.")
	}

	// Site owner = purchase.user_id (client kalau on-behalf-of, self kalau
	// caller = owner). Ini penting: reseller trigger create-site tapi site
	// tetap dimiliki client. Reseller/agent auto-di-add sebagai editor di
	// site_members (Phase 4 collab), supaya mereka bisa edit setelah handoff.
	ownerID := purchase.UserID

	site, err := h.sites.Create(c.Context(), ownerID, req.Slug, req.Name, &tpl.ID, tpl.Theme)
	if errors.Is(err, sites.ErrSlugTaken) {
		return httpx.Conflict(c, "slug already taken")
	}
	if errors.Is(err, sites.ErrLimitReached) {
		return httpx.Forbidden(c, "site limit reached")
	}
	if err != nil {
		return httpx.Internal(c, "create failed")
	}

	// Register owner + collab (reseller/agent) di site_members. EnsureOwner
	// idempotent — cover backward compat. AddMember untuk actor (kalau
	// on-behalf-of, purchased_by != nil dan != owner).
	if err := h.sites.EnsureOwner(c.Context(), site.ID, ownerID); err != nil {
		slog.Warn("site_members: ensure owner failed", "site_id", site.ID, "error", err)
	}
	if purchase.PurchasedBy != nil && *purchase.PurchasedBy != ownerID {
		actor := *purchase.PurchasedBy
		if err := h.sites.AddMember(c.Context(), site.ID, actor, sites.RoleEditor, &actor); err != nil {
			slog.Warn("site_members: add editor failed",
				"site_id", site.ID, "editor", actor, "error", err)
		}
	}

	// Atomic attach — kalau attach gagal (race: purchase sudah di-attach oleh
	// request lain antara GetByJobID + sini), rollback site untuk cegah
	// site "yatim" tanpa domain. AttachSite pakai WHERE site_id IS NULL, jadi
	// kalau race, hanya satu yang menang.
	if err := h.purchases.AttachSite(c.Context(), req.JobID, ownerID, site.ID); err != nil {
		_ = h.sites.Delete(c.Context(), site.ID, ownerID)
		if errors.Is(err, domain_purchase.ErrNotFound) {
			return httpx.Err(c, fiber.StatusConflict, "domain_already_attached",
				"Domain baru saja di-attach ke situs lain. Coba refresh dashboard.")
		}
		return httpx.Internal(c, "attach failed")
	}

	// Sync juga ke tabel registered_domains supaya /api/v1/domains list view
	// tidak misleading "Belum ada situs". Best-effort — kalau gagal, UI tetap
	// benar lewat COALESCE subselect fallback di ListDomainsByUser.
	if err := h.purchases.AttachDomainSite(c.Context(), purchase.Domain, ownerID, site.ID); err != nil {
		slog.Warn("registered_domains: attach site failed",
			"domain", purchase.Domain, "site_id", site.ID, "error", err)
	}

	// 1. Provision template pages.
	// Sebelum insert, extract shared header/footer dari home page → set ke
	// sites.layout_json + strip dari SEMUA page trees. Konsisten dengan
	// migration 0057 supaya site baru dari template langsung punya shared
	// layout tanpa perlu user edit manual. Failure di-log tapi tidak fatal —
	// site tetap ke-provision, user bisa setup header/footer manual.
	layoutJSON, pagesRaw, extractErr := sites.ExtractLayoutFromPagesJSON(tpl.Pages)
	if extractErr != nil {
		slog.Warn("template: extract layout failed", "site_id", site.ID, "error", extractErr)
		pagesRaw = tpl.Pages
	}
	if len(layoutJSON) > 0 {
		if err := h.sites.SetLayoutRaw(c.Context(), site.ID, layoutJSON); err != nil {
			slog.Warn("template: set layout failed", "site_id", site.ID, "error", err)
		}
	}
	var tplPages []struct {
		Slug   string          `json:"slug"`
		Title  string          `json:"title"`
		Tree   json.RawMessage `json:"tree"`
		SEO    json.RawMessage `json:"seo"`
		IsHome bool            `json:"is_home"`
	}
	if len(pagesRaw) > 0 {
		_ = json.Unmarshal(pagesRaw, &tplPages)
	}
	for _, p := range tplPages {
		if p.Slug == "" {
			continue
		}
		_, _ = h.pages.Create(c.Context(), site.ID, strings.ToLower(p.Slug), p.Title, p.Tree, p.SEO, p.IsHome)
	}

	// 2. Category-aware sample data so the new site feels alive immediately.
	switch tpl.Category {
	case "umkm":
		if h.products != nil {
			h.seedSampleProducts(c.Context(), site.ID)
		}
	case "blog":
		if h.blog != nil {
			h.seedSampleBlogPosts(c.Context(), site.ID)
		}
	}

	return httpx.Created(c, site)
}

// seedSampleProducts inserts 5 demo products. Failures are silent.
func (h *Handler) seedSampleProducts(ctx context.Context, siteID uuid.UUID) {
	for _, p := range sampleProducts() {
		_, _ = h.products.Create(ctx, siteID, p)
	}
}

// seedSampleBlogPosts inserts 3 demo posts (all published). Failures are silent.
func (h *Handler) seedSampleBlogPosts(ctx context.Context, siteID uuid.UUID) {
	for _, p := range sampleBlogPosts() {
		_, _ = h.blog.Create(ctx, siteID, p)
	}
}

func sampleProducts() []products.CreateInput {
	return []products.CreateInput{
		{
			Slug:        "keripik-singkong-original",
			Name:        "Keripik Singkong Original",
			Description: "Keripik singkong renyah dari bahan singkong pilihan petani lokal. Tanpa pengawet, hanya digoreng dengan minyak segar dan dibumbui garam laut. Cocok untuk camilan keluarga atau oleh-oleh.",
			Price:       15000,
			Currency:    "IDR",
			Category:    "Snack",
			Status:      "active",
		},
		{
			Slug:        "kopi-robusta-bubuk-250g",
			Name:        "Kopi Robusta Bubuk 250g",
			Description: "Single origin Lampung — kopi robusta dengan body kuat, aroma kacang, dan after-taste cokelat. Sudah di-grind medium, siap diseduh manual brew maupun espresso machine.",
			Price:       45000,
			Currency:    "IDR",
			Category:    "Minuman",
			Status:      "active",
		},
		{
			Slug:        "sambal-botol-pedas-manis",
			Name:        "Sambal Botol Pedas Manis",
			Description: "Sambal rumahan dengan cabai rawit segar, bawang putih, dan gula merah. Tanpa MSG, tanpa pengawet. Tahan 2 minggu di kulkas. Pas untuk lauk apa saja.",
			Price:       25000,
			Currency:    "IDR",
			Category:    "Bumbu",
			Status:      "active",
		},
		{
			Slug:        "teh-celup-premium-25-sachet",
			Name:        "Teh Celup Premium 25 Sachet",
			Description: "Teh hitam pilihan dari kebun Wonosobo, dipetik tangan dan dikeringkan secara tradisional. Setiap sachet menghasilkan teh dengan aroma kuat dan rasa lembut.",
			Price:       18000,
			Currency:    "IDR",
			Category:    "Minuman",
			Status:      "active",
		},
		{
			Slug:        "madu-hutan-murni-500ml",
			Name:        "Madu Hutan Murni 500ml",
			Description: "Madu liar dari hutan Kalimantan. Diambil langsung dari sarang lebah Apis dorsata di pepohonan tinggi. Tanpa campuran, tanpa pemanis tambahan. Tekstur kental, warna gelap.",
			Price:       95000,
			Currency:    "IDR",
			Category:    "Kesehatan",
			Status:      "active",
		},
	}
}

func sampleBlogPosts() []blog.CreateInput {
	return []blog.CreateInput{
		{
			Slug:       "selamat-datang-di-blog-saya",
			Title:      "Selamat Datang di Blog Saya",
			Excerpt:    "Tulisan pertama — sedikit cerita kenapa saya membuat blog ini dan apa yang bisa Anda harapkan ke depan.",
			AuthorName: "Admin",
			Status:     "published",
			ContentMD: `# Halo! 👋

Selamat datang di blog saya. Tulisan ini adalah post pertama, jadi mungkin agak personal — mau cerita sedikit kenapa saya membuat blog ini.

## Kenapa Blog?

Sudah lama saya pengen punya tempat sendiri untuk **mendokumentasikan apa yang saya pelajari**. Bukan untuk pamer, lebih ke arah arsip pribadi yang kebetulan publik. Saya percaya:

> *"You don't really understand something until you can explain it to someone else."*

Menulis memaksa saya berpikir lebih jelas. Ide yang terasa jelas di kepala sering kali ternyata belum solid begitu dituangkan ke kalimat.

## Apa yang Akan Saya Tulis?

Beberapa topik yang sering jadi minat saya:

- **Teknologi & coding** — tutorial, review tools, atau cerita debugging yang seru
- **Produktivitas** — workflow, habit, dan eksperimen-eksperimen kecil
- **Belajar & karir** — refleksi dari journey saya sebagai developer
- **Random thoughts** — kadang sekadar journal harian

## Sering Posting?

Target saya **1 artikel per minggu**, dipost setiap Senin pagi. Tapi kualitas selalu di atas kuantitas — kalau belum siap, ya nggak dipaksain.

## Tetap Terhubung

- **Email**: subscribe ke newsletter di halaman utama untuk dapat post baru langsung di inbox
- **Twitter/X**: follow untuk diskusi cepat & komentar

Terima kasih sudah mampir. Sampai jumpa di tulisan berikutnya!`,
		},
		{
			Slug:       "5-tools-favorit-untuk-produktivitas",
			Title:      "5 Tools Favorit untuk Produktivitas Harian",
			Excerpt:    "Tools yang saya pakai setiap hari dan benar-benar membuat perbedaan. Disclaimer: bukan affiliate.",
			AuthorName: "Admin",
			Status:     "published",
			ContentMD: `# 5 Tools Favorit untuk Produktivitas Harian

Saya percaya tools yang tepat bisa **jadi pembeda nyata**, bukan sekadar gimmick. Berikut 5 yang sering saya pakai. Tidak ada link affiliate — murni rekomendasi.

## 1. Obsidian

Aplikasi note-taking berbasis Markdown dengan **graph view** yang memvisualisasikan keterkaitan antar catatan. Cocok untuk membangun "second brain".

**Kenapa saya suka:**
- File-nya Markdown plain — tidak terkunci di satu aplikasi
- Plugin community yang sangat aktif
- Sync via iCloud / Git tanpa biaya tambahan

## 2. Raycast

Spotlight pada steroid untuk Mac. Quick launcher, clipboard history, snippets, extension marketplace — semuanya dalam satu app.

**Use case favorit:**
- Hitung kalkulasi dengan natural language ("100 USD in IDR")
- Akses bookmark, tab browser, dan dokumen instan
- Trigger workflow via shortcuts

## 3. Linear

Project management yang **opinionated**. Mereka fokus pada speed dan keyboard shortcut.

**Yang membuatnya beda:**
- Animasi yang super smooth
- Cycle planning yang masuk akal (1-2 minggu)
- Integrasi GitHub yang work seamlessly

## 4. Cron / Notion Calendar

Calendar app modern dengan integrasi multi-account. Cepat, clean, dan punya "scheduling links" untuk meeting.

## 5. Keychron K3

Bukan software, tapi worth mentioning. Keyboard mekanikal low-profile yang nyaman buat kerja seharian.

> *"Your tools should compound your effort, not consume it."*

Tools apa yang paling jadi game-changer untuk Anda? Reach out via halaman Kontak!`,
		},
		{
			Slug:       "belajar-bahasa-pemrograman-baru-dalam-30-hari",
			Title:      "Belajar Bahasa Pemrograman Baru dalam 30 Hari",
			Excerpt:    "Strategi yang saya pakai untuk belajar Go dari nol — bisa diadaptasi untuk bahasa lain.",
			AuthorName: "Admin",
			Status:     "published",
			ContentMD: `# Belajar Bahasa Pemrograman Baru dalam 30 Hari

Tahun lalu saya tantang diri belajar **Go** dari nol dalam 30 hari. Bukan untuk jadi expert, tapi cukup untuk membangun project nyata. Berikut metode yang work — bisa diadaptasi ke bahasa apa pun.

## Minggu 1: Fondasi

Hari 1-7 dihabiskan untuk **basic syntax**. Saya gunakan kombinasi:

1. **Buku resmi** — "The Go Programming Language" (Donovan & Kernighan)
2. **Interactive tutorial** — [Go by Example](https://gobyexample.com) untuk practice
3. **Video** — A Tour of Go di youtube (1-2 jam)

Target: bisa baca code Go orang lain dan paham yang terjadi.

## Minggu 2: Tools & Ekosistem

Setelah syntax solid, fokus ke:

- ` + "`" + `go mod` + "`" + ` untuk dependency management
- ` + "`" + `go test` + "`" + ` untuk testing — Go punya testing terintegrasi sejak day 1
- Standard library tour: ` + "`" + `net/http` + "`" + `, ` + "`" + `encoding/json` + "`" + `, ` + "`" + `database/sql` + "`" + `

## Minggu 3: Build Something

Tidak ada yang lebih efektif dari **membangun project nyata**. Saya pilih: REST API untuk URL shortener.

Stack:
- ` + "`" + `net/http` + "`" + ` saja (tanpa framework dulu)
- PostgreSQL via ` + "`" + `database/sql` + "`" + ` + ` + "`" + `pgx` + "`" + `
- Test dengan ` + "`" + `httptest` + "`" + `

Setiap masalah yang muncul saat coding = peluang belajar.

## Minggu 4: Refactor & Patterns

Setelah project jalan, **refactor** dengan idiom Go:

- Interface untuk abstraksi (dependency injection)
- Error handling yang explicit (no exceptions)
- Goroutine + channel untuk concurrency

## Hasil

Setelah 30 hari, saya bisa:
- Menulis Go code yang **idiomatic** (bukan terjemahan dari bahasa lama)
- **Membaca code Go open source** dengan nyaman
- Build dan deploy aplikasi backend nyata

## Kunci Suksesnya

1. **Konsisten** — 1-2 jam per hari LEBIH PENTING dari 12 jam di akhir pekan
2. **Build, jangan cuma baca** — tutorial saja tidak cukup
3. **Embrace the discomfort** — bahasa baru pasti terasa aneh awalnya, itu normal

Selamat mencoba! 🚀`,
		},
	}
}
