package exports

import (
	"archive/zip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/webbuilder/api/internal/blog"
	"github.com/webbuilder/api/internal/pages"
	"github.com/webbuilder/api/internal/products"
	"github.com/webbuilder/api/internal/sites"
)

type Builder struct {
	Sites    *sites.Repo
	Pages    *pages.Repo
	Products *products.Repo
	Blog     *blog.Repo

	// StoragePublicURL adalah URL publik tempat gambar unggahan user disajikan.
	// Guard SSRF memblokir alamat privat, sedangkan storage sering memang
	// internal (MinIO di localhost:9000, /uploads di api.localhost) — host ini
	// perlu di-allowlist supaya foto user tidak ikut terblokir.
	StoragePublicURL string
	// HTTPClient hanya untuk test; produksi memakai client ber-guard SSRF.
	HTTPClient *http.Client
}

// Write produces a zip bundle for the given site:
//   - one HTML file per page (including dynamic block content baked in)
//   - one HTML file per active product (under produk/<slug>/)
//   - one HTML file per published blog post (under blog/<slug>/)
//   - assets/css/styles.css, robots.txt, sitemap.xml
//
// Streamed directly to w — no temp files.
func (b *Builder) Write(ctx context.Context, w io.Writer, siteID, ownerID uuid.UUID) error {
	site, err := b.Sites.GetOwned(ctx, siteID, ownerID)
	if err != nil {
		return err
	}
	ps, err := b.Pages.ListBySite(ctx, siteID)
	if err != nil {
		return err
	}

	// Preload active products + published posts so dynamic blocks can render inline.
	// Error di-propagate, bukan dibuang: versi lama pakai `prods, _, _ =` sehingga
	// query gagal menghasilkan ZIP "sukses" yang isinya diam-diam kurang — user
	// baru sadar setelah situsnya live.
	var prods []products.Product
	if b.Products != nil {
		prods, err = listAll(func(limit, offset int) ([]products.Product, int, error) {
			return b.Products.ListPage(ctx, siteID, "%", "active", "newest", limit, offset)
		})
		if err != nil {
			return err
		}
	}
	var posts []blog.Post
	if b.Blog != nil {
		posts, err = listAll(func(limit, offset int) ([]blog.Post, int, error) {
			return b.Blog.ListPage(ctx, siteID, "%", "published", "published_desc", limit, offset)
		})
		if err != nil {
			return err
		}
	}

	data := &siteData{products: prods, posts: posts}

	z := zip.NewWriter(w)
	defer z.Close()

	if err := writeFile(z, "assets/css/styles.css", buildCSS(site.Theme)); err != nil {
		return err
	}
	if err := writeFile(z, "robots.txt", "User-agent: *\nAllow: /\nSitemap: /sitemap.xml\n"); err != nil {
		return err
	}
	if err := writeFile(z, "sitemap.xml", buildSitemap(ps, prods, posts)); err != nil {
		return err
	}

	// Shared layout (header/footer) — parse sekali, dipakai untuk semua page,
	// product detail, dan blog detail supaya konsisten dengan live renderer.
	headerBlocks, footerBlocks := parseLayout(site.Layout)
	// Rewrite link layout sekali di sini, bukan di renderPageHTML. Halaman detail
	// produk/blog memakai header yang sama tapi tidak pernah lewat rewriteLinks,
	// jadi navbar-nya masih menunjuk path in-app dan 404 di hasil export.
	// Idempotent: hasil rewrite tidak lagi cocok dengan key mana pun.
	rewriteLinks(&Tree{Blocks: headerBlocks}, ps)
	rewriteLinks(&Tree{Blocks: footerBlocks}, ps)

	// Render dulu ke memori, tulis belakangan: src gambar baru bisa ditulis
	// ulang ke path lokal setelah semua halaman diketahui dan file-nya terunduh.
	var docs []exportDoc
	for _, p := range ps {
		tree := parseTree(p.Tree)
		docs = append(docs, exportDoc{
			path: pageZipPath(p),
			html: renderPageHTML(site, p, tree, ps, headerBlocks, footerBlocks, data),
		})
	}

	for _, pr := range prods {
		docs = append(docs, exportDoc{
			path: "produk/" + pr.Slug + "/index.html",
			html: renderProductHTML(site, pr, headerBlocks, footerBlocks, data),
		})
	}
	for _, post := range posts {
		docs = append(docs, exportDoc{
			path: "blog/" + post.Slug + "/index.html",
			html: renderBlogPostHTML(site, post, headerBlocks, footerBlocks, data),
		})
	}
	imgs, failedImgs := downloadImages(ctx, z, collectImageSrcs(docs), b.assetClient())
	for _, d := range docs {
		// Urutan wajib: rewrite dulu (menghasilkan path root-absolute
		// /assets/img/...), baru relativize menyesuaikannya ke kedalaman file.
		if err := writeFile(z, d.path, relativize(rewriteImageSrcs(d.html, imgs), d.path)); err != nil {
			return err
		}
	}

	report := &exportReport{
		unknownBlocks: collectUnknownBlocks(docs),
		failedImages:  failedImgs,
	}
	if !report.empty() {
		slog.WarnContext(ctx, "export selesai dengan peringatan",
			"site_id", siteID,
			"unknown_blocks", report.unknownBlocks,
			"failed_images", len(report.failedImages))
		if err := writeFile(z, warningFileName, buildWarningFile(report)); err != nil {
			return err
		}
	}
	return nil
}

func (b *Builder) assetClient() *http.Client {
	if b.HTTPClient != nil {
		return b.HTTPClient
	}
	return newAssetClient(allowedInternalHosts(b.StoragePublicURL))
}

// relativize converts root-absolute href/src into paths relative to docPath.
//
// Semua renderer menulis path sebagai `/assets/...` dan `/slug/index.html`
// supaya seragam; di sinilah bentuk final ditentukan. Tanpa ini ZIP hanya jalan
// kalau di-host persis di root domain — dibuka langsung dari disk atau ditaruh
// di subfolder, CSS dan seluruh navigasi mati.
//
// `//host/...` (protocol-relative) dan URL absolut dilewati.
func relativize(html, docPath string) string {
	// `/` telanjang tidak punya padanan relatif yang valid (`href=""`).
	html = strings.ReplaceAll(html, `href="/"`, `href="/index.html"`)

	prefix := strings.Repeat("../", strings.Count(docPath, "/"))
	for _, attr := range []string{`href="`, `src="`} {
		var b strings.Builder
		b.Grow(len(html))
		rest := html
		for {
			i := strings.Index(rest, attr)
			if i < 0 {
				b.WriteString(rest)
				break
			}
			b.WriteString(rest[:i+len(attr)])
			rest = rest[i+len(attr):]
			if strings.HasPrefix(rest, "/") && !strings.HasPrefix(rest, "//") {
				b.WriteString(prefix)
				rest = rest[1:]
			}
		}
		html = b.String()
	}
	return html
}

// parseLayout decodes sites.layout_json into header + footer block slices.
// Empty/invalid JSON returns empty slices. Enabled flags default true kalau
// tidak di-set (backward compat) — set false eksplisit → section di-skip.
func parseLayout(raw json.RawMessage) ([]Block, []Block) {
	if len(raw) == 0 {
		return nil, nil
	}
	// Pakai pointer bool supaya bisa bedakan "tidak di-set" (default true)
	// vs "eksplisit false" (skip section).
	var l struct {
		Header        []Block `json:"header"`
		Footer        []Block `json:"footer"`
		HeaderEnabled *bool   `json:"header_enabled,omitempty"`
		FooterEnabled *bool   `json:"footer_enabled,omitempty"`
	}
	if err := json.Unmarshal(raw, &l); err != nil {
		return nil, nil
	}
	header := l.Header
	footer := l.Footer
	if l.HeaderEnabled != nil && !*l.HeaderEnabled {
		header = nil
	}
	if l.FooterEnabled != nil && !*l.FooterEnabled {
		footer = nil
	}
	return header, footer
}

// listAll pages through a repo ListPage sampai habis. Versi lama meminta 100
// item sekali jalan tanpa paging, jadi produk/artikel ke-101 dan seterusnya
// hilang dari export tanpa peringatan apa pun.
func listAll[T any](page func(limit, offset int) ([]T, int, error)) ([]T, error) {
	const batch = 200
	var out []T
	for offset := 0; ; offset += batch {
		items, total, err := page(batch, offset)
		if err != nil {
			return nil, err
		}
		out = append(out, items...)
		if len(items) < batch || len(out) >= total {
			return out, nil
		}
	}
}

func writeFile(z *zip.Writer, name, content string) error {
	f, err := z.CreateHeader(&zip.FileHeader{
		Name:     name,
		Method:   zip.Deflate,
		Modified: time.Now().UTC(),
	})
	if err != nil {
		return err
	}
	_, err = io.WriteString(f, content)
	return err
}

func pageZipPath(p pages.Page) string {
	if p.IsHome || p.Slug == "home" || p.Slug == "index" {
		return "index.html"
	}
	return p.Slug + "/index.html"
}

func pageRelHref(p pages.Page) string {
	if p.IsHome || p.Slug == "home" || p.Slug == "index" {
		return "/"
	}
	return "/" + p.Slug + "/"
}

// pageDocHref menunjuk file-nya langsung, bukan direktorinya. Link ke `slug/`
// mengandalkan server yang meresolusi index.html; dibuka dari disk via file://
// tidak ada yang meresolusi dan navigasi mati.
func pageDocHref(p pages.Page) string {
	return "/" + pageZipPath(p)
}

func renderPageHTML(site *sites.Site, p pages.Page, tree Tree, all []pages.Page, headerBlocks, footerBlocks []Block, d *siteData) string {
	// Shared layout wrap — prepend header + append footer supaya exported HTML
	// konsisten dengan live renderer. Concat sebelum rewriteLinks agar link
	// di navbar header ikut di-rewrite ke relative path exported.
	if len(headerBlocks) > 0 || len(footerBlocks) > 0 {
		merged := make([]Block, 0, len(headerBlocks)+len(tree.Blocks)+len(footerBlocks))
		merged = append(merged, headerBlocks...)
		merged = append(merged, tree.Blocks...)
		merged = append(merged, footerBlocks...)
		tree.Blocks = merged
	}
	// Rewrite navbar links from in-app paths to relative exported paths.
	rewriteLinks(&tree, all)

	var body strings.Builder
	renderTree(&body, tree, d)

	seo := parseSEO(p.SEO)
	title := seo.Title
	if title == "" {
		title = p.Title
	}
	if title == "" {
		title = site.Name
	}
	// wrapHTML, bukan <head> sendiri: salinan lokal sebelumnya tidak menyertakan
	// CustomHeadCode/CustomBodyEndCode, jadi halaman biasa kehilangan script
	// analytics/pixel milik user padahal halaman detail produk tetap punya.
	return wrapHTML(site, title, seo.Description, body.String())
}

func rewriteLinks(t *Tree, all []pages.Page) {
	// Build slug -> rel href map
	hrefBySlug := map[string]string{}
	for _, p := range all {
		hrefBySlug["/"+p.Slug] = pageDocHref(p)
		hrefBySlug["/"+p.Slug+"/"] = pageDocHref(p)
		if p.IsHome {
			hrefBySlug["/"] = pageDocHref(p)
		}
	}
	rewriteBlockLinks(t.Blocks, hrefBySlug)
}

// rewriteBlockLinks turun sampai ke children. Versi lama hanya menyentuh blok
// level atas, jadi menu di dalam Container/Columns tetap menunjuk path in-app
// dan 404 begitu ZIP di-host.
func rewriteBlockLinks(blocks []Block, hrefBySlug map[string]string) {
	for i := range blocks {
		props := blocks[i].Props
		if props == nil {
			rewriteBlockLinks(blocks[i].Children, hrefBySlug)
			continue
		}
		if links, ok := props["links"].([]any); ok {
			for j := range links {
				if m, ok := links[j].(map[string]any); ok {
					if h, ok := m["href"].(string); ok {
						if rep, ok := hrefBySlug[h]; ok {
							m["href"] = rep
						}
					}
				}
			}
		}
		if h, ok := props["ctaHref"].(string); ok {
			if rep, ok := hrefBySlug[h]; ok {
				props["ctaHref"] = rep
			}
		}
		rewriteBlockLinks(blocks[i].Children, hrefBySlug)
	}
}

type seoData struct {
	Title       string `json:"title"`
	Description string `json:"description"`
}

func parseSEO(raw []byte) seoData {
	var s seoData
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &s)
	}
	return s
}

func buildSitemap(ps []pages.Page, prods []products.Product, posts []blog.Post) string {
	var b strings.Builder
	b.WriteString(`<?xml version="1.0" encoding="UTF-8"?>` + "\n")
	b.WriteString(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` + "\n")
	for _, p := range ps {
		fmt.Fprintf(&b, "  <url><loc>%s</loc></url>\n", pageRelHref(p))
	}
	for _, pr := range prods {
		fmt.Fprintf(&b, "  <url><loc>/produk/%s/</loc></url>\n", esc(pr.Slug))
	}
	for _, post := range posts {
		fmt.Fprintf(&b, "  <url><loc>/blog/%s/</loc></url>\n", esc(post.Slug))
	}
	b.WriteString(`</urlset>` + "\n")
	return b.String()
}
