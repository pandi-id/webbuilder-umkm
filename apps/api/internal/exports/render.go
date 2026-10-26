package exports

import (
	"encoding/json"
	"fmt"
	stdhtml "html"
	"strings"

	"github.com/gomarkdown/markdown"
	mdhtml "github.com/gomarkdown/markdown/html"
	"github.com/gomarkdown/markdown/parser"
	"github.com/webbuilder/api/internal/blog"
	"github.com/webbuilder/api/internal/products"
	"github.com/webbuilder/api/internal/sites"
)

// Block matches the JSON tree shape: { type, props, children?, layout?, themeOverride? }.
// `Layout` + `ThemeOverride` are optional per-block metadata authored in the
// editor's Layout & Style panel. `Children` populated only for container
// blocks (Container, Columns) — see apps/web/lib/blocks.ts.
type Block struct {
	Type          string              `json:"type"`
	Props         map[string]any      `json:"props,omitempty"`
	Children      []Block             `json:"children,omitempty"`
	Layout        *BlockLayout        `json:"layout,omitempty"`
	ThemeOverride *BlockThemeOverride `json:"themeOverride,omitempty"`
}

type BlockLayout struct {
	PT       *float64 `json:"pt,omitempty"`
	PR       *float64 `json:"pr,omitempty"`
	PB       *float64 `json:"pb,omitempty"`
	PL       *float64 `json:"pl,omitempty"`
	MT       *float64 `json:"mt,omitempty"`
	MB       *float64 `json:"mb,omitempty"`
	MaxWidth string   `json:"maxWidth,omitempty"` // full|narrow|prose|wide
	Align    string   `json:"align,omitempty"`    // left|center|right
	BG       string   `json:"bg,omitempty"`

	Hidden     *HiddenAt        `json:"hidden,omitempty"`
	Responsive *ResponsiveBlock `json:"responsive,omitempty"`
}

type HiddenAt struct {
	Mobile  bool `json:"mobile,omitempty"`
	Tablet  bool `json:"tablet,omitempty"`
	Desktop bool `json:"desktop,omitempty"`
}

type ResponsiveBlock struct {
	Tablet  *ResponsivePatch `json:"tablet,omitempty"`
	Desktop *ResponsivePatch `json:"desktop,omitempty"`
}

type ResponsivePatch struct {
	PT       *float64 `json:"pt,omitempty"`
	PR       *float64 `json:"pr,omitempty"`
	PB       *float64 `json:"pb,omitempty"`
	PL       *float64 `json:"pl,omitempty"`
	MT       *float64 `json:"mt,omitempty"`
	MB       *float64 `json:"mb,omitempty"`
	MaxWidth string   `json:"maxWidth,omitempty"`
	Align    string   `json:"align,omitempty"`
	BG       string   `json:"bg,omitempty"`
}

type BlockThemeOverride struct {
	Primary   string `json:"primary,omitempty"`
	Secondary string `json:"secondary,omitempty"`
	BG        string `json:"bg,omitempty"`
	FG        string `json:"fg,omitempty"`
}

type Tree struct {
	Blocks []Block `json:"blocks"`
}

func parseTree(raw json.RawMessage) Tree {
	if len(raw) == 0 {
		return Tree{}
	}
	var t Tree
	_ = json.Unmarshal(raw, &t)
	return t
}

// siteData adalah konten DB yang sudah dimuat di muka supaya blok dinamis bisa
// di-materialisasi tanpa query per blok. Boleh nil: blok dinamis lalu render
// sebagai empty state, bukan panic.
type siteData struct {
	products []products.Product
	posts    []blog.Post
}

// renderTree writes block HTML mirroring apps/renderer/components/Blocks.tsx output,
// but using class names from styles.css instead of Tailwind utilities.
func renderTree(b *strings.Builder, t Tree, d *siteData) {
	// Emit the per-block responsive @media CSS as a single <style> tag at the
	// top so static HTML stays self-contained.
	if css := buildResponsiveCSS(t.Blocks); css != "" {
		fmt.Fprintf(b, `<style>%s</style>`, css)
	}
	for i, blk := range t.Blocks {
		openLayoutWrap(b, blk, i)
		renderBlock(b, blk, d)
		closeLayoutWrap(b, blk)
	}
}

// buildResponsiveCSS concatenates @media rules + hidden visibility for every
// block in the tree. Empty string when nothing needs it.
func buildResponsiveCSS(blocks []Block) string {
	var sb strings.Builder
	for i, blk := range blocks {
		if blk.Layout == nil {
			continue
		}
		klass := fmt.Sprintf("wb-blk-%d", i)
		writeBreakpoint(&sb, klass, "(min-width:768px)", blk.Layout.Responsive.tabletPatch())
		writeBreakpoint(&sb, klass, "(min-width:1024px)", blk.Layout.Responsive.desktopPatch())
		if h := blk.Layout.Hidden; h != nil {
			if h.Mobile {
				fmt.Fprintf(&sb, "@media (max-width:767px){.%s{display:none!important}}", klass)
			}
			if h.Tablet {
				fmt.Fprintf(&sb, "@media (min-width:768px) and (max-width:1023px){.%s{display:none!important}}", klass)
			}
			if h.Desktop {
				fmt.Fprintf(&sb, "@media (min-width:1024px){.%s{display:none!important}}", klass)
			}
		}
	}
	return sb.String()
}

// patchHelpers — nil-safe accessors. Keep ResponsiveBlock optional + per-bp
// patches optional so users can opt in to just one breakpoint.
func (r *ResponsiveBlock) tabletPatch() *ResponsivePatch {
	if r == nil {
		return nil
	}
	return r.Tablet
}
func (r *ResponsiveBlock) desktopPatch() *ResponsivePatch {
	if r == nil {
		return nil
	}
	return r.Desktop
}

func writeBreakpoint(sb *strings.Builder, klass, mq string, p *ResponsivePatch) {
	if p == nil {
		return
	}
	body := patchToCSSString(p)
	innerW := maxWidthRule(klass, p.MaxWidth)
	if body == "" && innerW == "" {
		return
	}
	fmt.Fprintf(sb, "@media %s{.%s{%s}%s}", mq, klass, body, innerW)
}

func patchToCSSString(p *ResponsivePatch) string {
	var parts []string
	if p.PT != nil {
		parts = append(parts, fmt.Sprintf("padding-top:%grem", *p.PT))
	}
	if p.PR != nil {
		parts = append(parts, fmt.Sprintf("padding-right:%grem", *p.PR))
	}
	if p.PB != nil {
		parts = append(parts, fmt.Sprintf("padding-bottom:%grem", *p.PB))
	}
	if p.PL != nil {
		parts = append(parts, fmt.Sprintf("padding-left:%grem", *p.PL))
	}
	if p.MT != nil {
		parts = append(parts, fmt.Sprintf("margin-top:%grem", *p.MT))
	}
	if p.MB != nil {
		parts = append(parts, fmt.Sprintf("margin-bottom:%grem", *p.MB))
	}
	if p.Align != "" {
		parts = append(parts, "text-align:"+p.Align)
	}
	if p.BG != "" {
		parts = append(parts, "background-color:"+p.BG)
	}
	return strings.Join(parts, ";")
}

func maxWidthRule(klass, mw string) string {
	w, ok := maxWidthPx[mw]
	if !ok || mw == "full" {
		return ""
	}
	return fmt.Sprintf(".%s .wb-blk-inner{max-width:%s}", klass, w)
}

// Tailwind-equivalent max-width presets — must match apps/web/lib/blockLayout.ts.
var maxWidthPx = map[string]string{
	"full":   "100%",
	"wide":   "1280px",
	"narrow": "640px",
	"prose":  "720px",
}

// openLayoutWrap emits the per-block wrapper div(s) that apply user-set padding /
// margin / alignment / colour override. Mirrors the renderer wrapper exactly so
// exported static HTML matches live render byte-for-byte (modulo formatting).
// The `idx` becomes the wrapper's unique class — `<style>` rules emitted by
// buildResponsiveCSS scope themselves to this class.
func openLayoutWrap(b *strings.Builder, blk Block, idx int) {
	klass := fmt.Sprintf("wb-blk-%d", idx)
	wrap := layoutWrapStyle(blk)
	inner := maxWidthInnerStyle(blk)
	if wrap == "" && inner == "" {
		fmt.Fprintf(b, `<div class="%s">`, klass)
		return
	}
	if wrap != "" {
		fmt.Fprintf(b, `<div class="%s" style="%s">`, klass, escAttr(wrap))
	} else {
		fmt.Fprintf(b, `<div class="%s">`, klass)
	}
	if inner != "" {
		fmt.Fprintf(b, `<div class="wb-blk-inner" style="%s">`, escAttr(inner))
	}
}

func closeLayoutWrap(b *strings.Builder, blk Block) {
	inner := maxWidthInnerStyle(blk)
	if inner != "" {
		b.WriteString(`</div>`)
	}
	b.WriteString(`</div>`)
}

func layoutWrapStyle(blk Block) string {
	var parts []string
	if l := blk.Layout; l != nil {
		if l.PT != nil {
			parts = append(parts, fmt.Sprintf("padding-top:%grem", *l.PT))
		}
		if l.PR != nil {
			parts = append(parts, fmt.Sprintf("padding-right:%grem", *l.PR))
		}
		if l.PB != nil {
			parts = append(parts, fmt.Sprintf("padding-bottom:%grem", *l.PB))
		}
		if l.PL != nil {
			parts = append(parts, fmt.Sprintf("padding-left:%grem", *l.PL))
		}
		if l.MT != nil {
			parts = append(parts, fmt.Sprintf("margin-top:%grem", *l.MT))
		}
		if l.MB != nil {
			parts = append(parts, fmt.Sprintf("margin-bottom:%grem", *l.MB))
		}
		if l.BG != "" {
			parts = append(parts, "background-color:"+l.BG)
		}
		if l.Align != "" {
			parts = append(parts, "text-align:"+l.Align)
		}
	}
	if o := blk.ThemeOverride; o != nil {
		if o.Primary != "" {
			parts = append(parts, "--color-primary:"+o.Primary)
		}
		if o.Secondary != "" {
			parts = append(parts, "--color-secondary:"+o.Secondary)
		}
		if o.BG != "" {
			parts = append(parts, "--color-bg:"+o.BG)
			// Paint the wrapper background so blocks without bg-background
			// still visibly take the override. layout.bg, if set, was
			// appended earlier and wins per CSS source order.
			parts = append(parts, "background-color:"+o.BG)
		}
		if o.FG != "" {
			parts = append(parts, "--color-fg:"+o.FG)
			parts = append(parts, "color:"+o.FG)
		}
	}
	return strings.Join(parts, ";")
}

func maxWidthInnerStyle(blk Block) string {
	if blk.Layout == nil || blk.Layout.MaxWidth == "" || blk.Layout.MaxWidth == "full" {
		return ""
	}
	w, ok := maxWidthPx[blk.Layout.MaxWidth]
	if !ok {
		return ""
	}
	return "max-width:" + w + ";margin-left:auto;margin-right:auto;width:100%"
}

func renderBlock(b *strings.Builder, blk Block, d *siteData) {
	p := blk.Props
	switch blk.Type {
	case "Navbar":
		b.WriteString(`<header class="wb-navbar"><div class="wb-container wb-navbar-inner">`)
		fmt.Fprintf(b, `<strong class="wb-brand">%s</strong>`, esc(str(p, "brand")))
		b.WriteString(`<nav class="wb-nav">`)
		for _, l := range arr(p, "links") {
			if m, ok := l.(map[string]any); ok {
				fmt.Fprintf(b, `<a href="%s">%s</a>`, escAttr(str(m, "href")), esc(str(m, "label")))
			}
		}
		b.WriteString(`</nav></div></header>`)

	case "Hero":
		b.WriteString(`<section class="wb-hero">`)
		fmt.Fprintf(b, `<h1>%s</h1>`, esc(str(p, "title")))
		if s := str(p, "subtitle"); s != "" {
			fmt.Fprintf(b, `<p class="wb-hero-sub">%s</p>`, esc(s))
		}
		if l := str(p, "ctaLabel"); l != "" {
			fmt.Fprintf(b, `<a href="%s" class="wb-btn wb-btn-primary">%s</a>`,
				escAttr(strOr(p, "ctaHref", "#")), esc(l))
		}
		b.WriteString(`</section>`)

	case "Heading":
		level := intOr(p, "level", 2)
		if level < 1 || level > 6 {
			level = 2
		}
		fmt.Fprintf(b, `<h%d class="wb-heading">%s</h%d>`, level, esc(str(p, "text")), level)

	case "Text":
		fmt.Fprintf(b, `<p class="wb-text">%s</p>`, escMultiline(str(p, "body")))

	case "RichText":
		// renderMarkdown uses gomarkdown with SkipHTML — same XSS hardening as
		// blog post export. Wraps in .wb-prose for typographic CSS.
		fmt.Fprintf(b, `<div class="wb-prose">%s</div>`, renderMarkdown(str(p, "body")))

	case "Section":
		b.WriteString(`<section class="wb-section">`)
		if t := str(p, "title"); t != "" {
			fmt.Fprintf(b, `<h3>%s</h3>`, esc(t))
		}
		fmt.Fprintf(b, `<p>%s</p></section>`, escMultiline(str(p, "body")))

	case "FeatureList":
		b.WriteString(`<section class="wb-features">`)
		if t := str(p, "title"); t != "" {
			fmt.Fprintf(b, `<h3>%s</h3>`, esc(t))
		}
		b.WriteString(`<div class="wb-grid wb-grid-3">`)
		for _, it := range arr(p, "items") {
			if m, ok := it.(map[string]any); ok {
				b.WriteString(`<div class="wb-feature">`)
				fmt.Fprintf(b, `<div class="wb-feature-title">%s</div>`, esc(str(m, "title")))
				fmt.Fprintf(b, `<div class="wb-feature-desc">%s</div></div>`, esc(str(m, "desc")))
			}
		}
		b.WriteString(`</div></section>`)

	case "ProductGrid":
		b.WriteString(`<section class="wb-products">`)
		if t := str(p, "title"); t != "" {
			fmt.Fprintf(b, `<h3>%s</h3>`, esc(t))
		}
		b.WriteString(`<div class="wb-grid wb-grid-3">`)
		for _, it := range arr(p, "items") {
			if m, ok := it.(map[string]any); ok {
				b.WriteString(`<div class="wb-product">`)
				if img := str(m, "image"); img != "" {
					fmt.Fprintf(b, `<img src="%s" alt="%s" loading="lazy" decoding="async" />`, escAttr(img), escAttr(str(m, "name")))
				} else {
					b.WriteString(`<div class="wb-product-img-placeholder"></div>`)
				}
				b.WriteString(`<div class="wb-product-body">`)
				fmt.Fprintf(b, `<div class="wb-product-name">%s</div>`, esc(str(m, "name")))
				fmt.Fprintf(b, `<div class="wb-product-price">%s</div>`, esc(str(m, "price")))
				b.WriteString(`</div></div>`)
			}
		}
		b.WriteString(`</div></section>`)

	case "ProjectGrid":
		b.WriteString(`<section class="wb-projects"><div class="wb-grid wb-grid-2">`)
		for _, it := range arr(p, "items") {
			if m, ok := it.(map[string]any); ok {
				href := strOr(m, "href", "#")
				fmt.Fprintf(b, `<a class="wb-project" href="%s">`, escAttr(href))
				fmt.Fprintf(b, `<div class="wb-project-name">%s</div>`, esc(str(m, "name")))
				fmt.Fprintf(b, `<div class="wb-project-desc">%s</div></a>`, esc(str(m, "desc")))
			}
		}
		b.WriteString(`</div></section>`)

	case "BlogList":
		b.WriteString(`<section class="wb-bloglist">`)
		for _, it := range arr(p, "items") {
			if m, ok := it.(map[string]any); ok {
				href := strOr(m, "href", "#")
				fmt.Fprintf(b, `<a class="wb-blog-item" href="%s">`, escAttr(href))
				fmt.Fprintf(b, `<h3>%s</h3>`, esc(str(m, "title")))
				fmt.Fprintf(b, `<p>%s</p></a>`, esc(str(m, "excerpt")))
			}
		}
		b.WriteString(`</section>`)

	case "Testimonial":
		b.WriteString(`<section class="wb-testimonials">`)
		for _, it := range arr(p, "items") {
			if m, ok := it.(map[string]any); ok {
				fmt.Fprintf(b, `<blockquote class="wb-testimonial">&ldquo;%s&rdquo; &mdash; <span>%s</span></blockquote>`,
					esc(str(m, "text")), esc(str(m, "name")))
			}
		}
		b.WriteString(`</section>`)

	case "Footer":
		fmt.Fprintf(b, `<footer class="wb-footer"><div class="wb-container">%s</div></footer>`, esc(str(p, "copyright")))

	// ==========================================================================
	// CONTAINER primitives — recursive. Children render via renderBlock too.
	// Layout panel + per-block colour override on the container apply to the
	// wrapper via openLayoutWrap (already in the call site), so we only emit
	// the structural shell here.
	// ==========================================================================

	case "Container":
		gap := strOr(p, "gap", "1rem")
		fmt.Fprintf(b, `<section class="wb-container-block"><div class="wb-container-inner" style="display:flex;flex-direction:column;gap:%s">`, escAttr(gap))
		for _, child := range blk.Children {
			renderBlock(b, child, d)
		}
		b.WriteString(`</div></section>`)

	case "Columns":
		cols := intOr(p, "columns", 2)
		if cols < 1 {
			cols = 1
		}
		if cols > 4 {
			cols = 4
		}
		gap := strOr(p, "gap", "1rem")
		// Distribute children round-robin across columns — matches editor +
		// renderer behaviour so previews and live agree.
		cells := make([][]Block, cols)
		for ci, child := range blk.Children {
			cells[ci%cols] = append(cells[ci%cols], child)
		}
		fmt.Fprintf(b,
			`<section class="wb-columns-block"><div class="wb-columns-grid" style="display:grid;grid-template-columns:repeat(%d,minmax(0,1fr));gap:%s">`,
			cols, escAttr(gap),
		)
		for _, col := range cells {
			b.WriteString(`<div style="display:flex;flex-direction:column;gap:1rem">`)
			for _, child := range col {
				renderBlock(b, child, d)
			}
			b.WriteString(`</div>`)
		}
		b.WriteString(`</div></section>`)

	// ==========================================================================
	// PRO blocks — markup matches renderer/editor 1:1. All animation lives in
	// the exported CSS bundle (see styles.go appending PRO_CSS), so static HTML
	// stays clean and content-only.
	// ==========================================================================

	case "AuroraHero":
		b.WriteString(`<section class="wb-pro-aurora">`)
		if v := str(p, "eyebrow"); v != "" {
			fmt.Fprintf(b, `<div class="wb-pro-eyebrow">%s</div>`, esc(v))
		}
		fmt.Fprintf(b, `<h1>%s</h1>`, esc(str(p, "title")))
		if v := str(p, "subtitle"); v != "" {
			fmt.Fprintf(b, `<p class="wb-pro-sub">%s</p>`, esc(v))
		}
		if v := str(p, "ctaLabel"); v != "" {
			fmt.Fprintf(b, `<a href="%s" class="wb-pro-cta">%s</a>`,
				escAttr(strOr(p, "ctaHref", "#")), esc(v))
		}
		b.WriteString(`</section>`)

	case "SpotlightHero":
		b.WriteString(`<section class="wb-pro-spotlight">`)
		fmt.Fprintf(b, `<h1>%s</h1>`, esc(str(p, "title")))
		if v := str(p, "subtitle"); v != "" {
			fmt.Fprintf(b, `<p class="wb-pro-sub">%s</p>`, esc(v))
		}
		if v := str(p, "ctaLabel"); v != "" {
			fmt.Fprintf(b, `<a href="%s" class="wb-pro-cta">%s</a>`,
				escAttr(strOr(p, "ctaHref", "#")), esc(v))
		}
		b.WriteString(`</section>`)

	case "HighlightHero":
		b.WriteString(`<section class="wb-pro-highlight"><h1>`)
		fmt.Fprintf(b, `%s <span class="wb-pro-mark">%s</span> %s`,
			esc(str(p, "title")), esc(str(p, "highlight")), esc(str(p, "titleAfter")))
		b.WriteString(`</h1>`)
		if v := str(p, "subtitle"); v != "" {
			fmt.Fprintf(b, `<p class="wb-pro-sub">%s</p>`, esc(v))
		}
		if v := str(p, "ctaLabel"); v != "" {
			fmt.Fprintf(b, `<a href="%s" class="wb-pro-cta">%s</a>`,
				escAttr(strOr(p, "ctaHref", "#")), esc(v))
		}
		b.WriteString(`</section>`)

	case "LampHero":
		b.WriteString(`<section class="wb-pro-lamp">`)
		fmt.Fprintf(b, `<h1>%s</h1>`, esc(str(p, "title")))
		if v := str(p, "subtitle"); v != "" {
			fmt.Fprintf(b, `<p class="wb-pro-sub">%s</p>`, esc(v))
		}
		if v := str(p, "ctaLabel"); v != "" {
			fmt.Fprintf(b, `<a href="%s" class="wb-pro-cta">%s</a>`,
				escAttr(strOr(p, "ctaHref", "#")), esc(v))
		}
		b.WriteString(`</section>`)

	case "TypewriterHero":
		b.WriteString(`<section class="wb-pro-typewriter"><h1>`)
		fmt.Fprintf(b, `%s <span class="wb-pro-typed">%s</span>`,
			esc(str(p, "prefix")), esc(str(p, "typed")))
		b.WriteString(`</h1>`)
		if v := str(p, "subtitle"); v != "" {
			fmt.Fprintf(b, `<p class="wb-pro-sub">%s</p>`, esc(v))
		}
		if v := str(p, "ctaLabel"); v != "" {
			fmt.Fprintf(b, `<a href="%s" class="wb-pro-cta">%s</a>`,
				escAttr(strOr(p, "ctaHref", "#")), esc(v))
		}
		b.WriteString(`</section>`)

	case "GradientTextHero":
		b.WriteString(`<section class="wb-pro-gtext">`)
		if v := str(p, "eyebrow"); v != "" {
			fmt.Fprintf(b, `<div class="wb-pro-eyebrow">%s</div>`, esc(v))
		}
		fmt.Fprintf(b, `<h1>%s</h1>`, esc(str(p, "title")))
		if v := str(p, "subtitle"); v != "" {
			fmt.Fprintf(b, `<p class="wb-pro-sub">%s</p>`, esc(v))
		}
		if v := str(p, "ctaLabel"); v != "" {
			fmt.Fprintf(b, `<a href="%s" class="wb-pro-cta">%s</a>`,
				escAttr(strOr(p, "ctaHref", "#")), esc(v))
		}
		b.WriteString(`</section>`)

	case "BeamsSection":
		b.WriteString(`<section class="wb-pro-beams">`)
		fmt.Fprintf(b, `<h2>%s</h2>`, esc(str(p, "title")))
		if v := str(p, "subtitle"); v != "" {
			fmt.Fprintf(b, `<p class="wb-pro-sub">%s</p>`, esc(v))
		}
		b.WriteString(`</section>`)

	case "MeteorsSection":
		b.WriteString(`<section class="wb-pro-meteors">`)
		// 5 meteor spans match the nth-child CSS rules.
		b.WriteString(`<span class="wb-pro-meteor"></span><span class="wb-pro-meteor"></span><span class="wb-pro-meteor"></span><span class="wb-pro-meteor"></span><span class="wb-pro-meteor"></span>`)
		fmt.Fprintf(b, `<h2>%s</h2>`, esc(str(p, "title")))
		if v := str(p, "subtitle"); v != "" {
			fmt.Fprintf(b, `<p class="wb-pro-sub">%s</p>`, esc(v))
		}
		b.WriteString(`</section>`)

	case "GradientMeshSection":
		b.WriteString(`<section class="wb-pro-mesh"><span class="wb-pro-mesh-blob"></span><span class="wb-pro-mesh-blob"></span><span class="wb-pro-mesh-blob"></span>`)
		fmt.Fprintf(b, `<h2>%s</h2>`, esc(str(p, "title")))
		if v := str(p, "subtitle"); v != "" {
			fmt.Fprintf(b, `<p class="wb-pro-sub">%s</p>`, esc(v))
		}
		b.WriteString(`</section>`)

	case "WavyDivider":
		b.WriteString(`<section class="wb-pro-wave"><div class="wb-pro-wave-track"><svg viewBox="0 0 1200 60" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><path d="M0 30 Q 150 0 300 30 T 600 30 T 900 30 T 1200 30 V60 H0 Z" fill="currentColor" opacity="0.15"/></svg></div>`)
		if v := str(p, "label"); v != "" {
			fmt.Fprintf(b, `<div class="wb-pro-wave-label">%s</div>`, esc(v))
		}
		b.WriteString(`</section>`)

	case "DotPatternSection":
		b.WriteString(`<section class="wb-pro-dots">`)
		fmt.Fprintf(b, `<h2>%s</h2>`, esc(str(p, "title")))
		if v := str(p, "subtitle"); v != "" {
			fmt.Fprintf(b, `<p class="wb-pro-sub">%s</p>`, esc(v))
		}
		b.WriteString(`</section>`)

	case "GlowCardGrid":
		b.WriteString(`<section class="wb-pro-glow-grid">`)
		if v := str(p, "title"); v != "" {
			fmt.Fprintf(b, `<h2>%s</h2>`, esc(v))
		}
		b.WriteString(`<div class="wb-pro-grid">`)
		for _, it := range arr(p, "items") {
			if m, ok := it.(map[string]any); ok {
				fmt.Fprintf(b, `<div class="wb-pro-glow-card"><div class="wb-pro-glow-inner"><h3>%s</h3><p>%s</p></div></div>`,
					esc(str(m, "title")), esc(str(m, "desc")))
			}
		}
		b.WriteString(`</div></section>`)

	case "TiltCardGrid":
		b.WriteString(`<section class="wb-pro-tilt-grid">`)
		if v := str(p, "title"); v != "" {
			fmt.Fprintf(b, `<h2>%s</h2>`, esc(v))
		}
		b.WriteString(`<div class="wb-pro-grid">`)
		for _, it := range arr(p, "items") {
			if m, ok := it.(map[string]any); ok {
				fmt.Fprintf(b, `<div class="wb-pro-tilt-card"><h3>%s</h3><p>%s</p></div>`,
					esc(str(m, "title")), esc(str(m, "desc")))
			}
		}
		b.WriteString(`</div></section>`)

	case "BorderBeamCard":
		b.WriteString(`<section class="wb-pro-beam-card"><div class="wb-pro-beam-wrap"><div class="wb-pro-beam-inner">`)
		fmt.Fprintf(b, `<div style="font-size:0.7rem;letter-spacing:0.15em;text-transform:uppercase;opacity:0.6">%s</div>`, esc(str(p, "subtitle")))
		fmt.Fprintf(b, `<h3 style="margin-top:0.25rem;font-size:1.125rem;font-weight:700">%s</h3>`, esc(str(p, "title")))
		fmt.Fprintf(b, `<div class="wb-pro-beam-price">%s<span class="wb-pro-beam-period">%s</span></div>`,
			esc(str(p, "price")), esc(str(p, "period")))
		b.WriteString(`<ul>`)
		for _, it := range arr(p, "bullets") {
			if m, ok := it.(map[string]any); ok {
				fmt.Fprintf(b, `<li>%s</li>`, esc(str(m, "text")))
			}
		}
		b.WriteString(`</ul>`)
		if v := str(p, "ctaLabel"); v != "" {
			fmt.Fprintf(b, `<a href="%s" class="wb-pro-cta">%s</a>`,
				escAttr(strOr(p, "ctaHref", "#")), esc(v))
		}
		b.WriteString(`</div></div></section>`)

	case "CardStackShowcase":
		b.WriteString(`<section class="wb-pro-stack">`)
		if v := str(p, "title"); v != "" {
			fmt.Fprintf(b, `<h2>%s</h2>`, esc(v))
		}
		b.WriteString(`<div class="wb-pro-stack-wrap">`)
		count := 0
		for _, it := range arr(p, "items") {
			if count >= 3 {
				break
			}
			if m, ok := it.(map[string]any); ok {
				fmt.Fprintf(b, `<div class="wb-pro-stack-card"><blockquote>&ldquo;%s&rdquo;</blockquote><div class="wb-pro-stack-meta"><div class="wb-pro-stack-name">%s</div><div class="wb-pro-stack-role">%s</div></div></div>`,
					esc(str(m, "quote")), esc(str(m, "name")), esc(str(m, "role")))
				count++
			}
		}
		b.WriteString(`</div></section>`)

	case "HoverGlowGrid":
		b.WriteString(`<section class="wb-pro-hover-grid">`)
		if v := str(p, "title"); v != "" {
			fmt.Fprintf(b, `<h2>%s</h2>`, esc(v))
		}
		b.WriteString(`<div class="wb-pro-grid">`)
		for _, it := range arr(p, "items") {
			if m, ok := it.(map[string]any); ok {
				fmt.Fprintf(b, `<div class="wb-pro-hover-card"><h3>%s</h3><p>%s</p></div>`,
					esc(str(m, "title")), esc(str(m, "desc")))
			}
		}
		b.WriteString(`</div></section>`)

	case "AnimatedCounterStats":
		b.WriteString(`<section class="wb-pro-counters">`)
		if v := str(p, "title"); v != "" {
			fmt.Fprintf(b, `<h2>%s</h2>`, esc(v))
		}
		b.WriteString(`<div class="wb-pro-grid">`)
		for i, it := range arr(p, "items") {
			if m, ok := it.(map[string]any); ok {
				fmt.Fprintf(b, `<div class="wb-pro-counter-cell"><div class="wb-pro-counter-value" style="animation-delay:%.2fs">%s</div><div class="wb-pro-counter-label">%s</div></div>`,
					float64(i)*0.15, esc(str(m, "value")), esc(str(m, "label")))
			}
		}
		b.WriteString(`</div></section>`)

	case "MovingBorderCTA":
		b.WriteString(`<section class="wb-pro-mb-cta">`)
		fmt.Fprintf(b, `<h2>%s</h2>`, esc(str(p, "title")))
		if v := str(p, "subtitle"); v != "" {
			fmt.Fprintf(b, `<p class="wb-pro-sub">%s</p>`, esc(v))
		}
		if v := str(p, "ctaLabel"); v != "" {
			fmt.Fprintf(b, `<a href="%s" class="wb-pro-mb-btn"><span class="wb-pro-mb-inner">%s</span></a>`,
				escAttr(strOr(p, "ctaHref", "#")), esc(v))
		}
		b.WriteString(`</section>`)

	case "InfiniteMarqueeLogos":
		b.WriteString(`<section class="wb-pro-marquee">`)
		if v := str(p, "title"); v != "" {
			fmt.Fprintf(b, `<h2>%s</h2>`, esc(v))
		}
		// Each row is duplicated inline so the keyframe loop is seamless.
		for _, key := range []string{"itemsTop", "itemsBottom"} {
			b.WriteString(`<div class="wb-pro-marquee-row">`)
			items := arr(p, key)
			for n := 0; n < 2; n++ {
				for _, it := range items {
					if m, ok := it.(map[string]any); ok {
						fmt.Fprintf(b, `<span>%s</span>`, esc(str(m, "name")))
					}
				}
			}
			b.WriteString(`</div>`)
		}
		b.WriteString(`</section>`)

	case "OrbitFeatures":
		b.WriteString(`<section class="wb-pro-orbit">`)
		fmt.Fprintf(b, `<h2>%s</h2>`, esc(str(p, "title")))
		if v := str(p, "subtitle"); v != "" {
			fmt.Fprintf(b, `<p class="wb-pro-sub">%s</p>`, esc(v))
		}
		b.WriteString(`<div class="wb-pro-orbit-stage">`)
		fmt.Fprintf(b, `<div class="wb-pro-orbit-center">%s</div>`, esc(str(p, "brand")))
		b.WriteString(`<div class="wb-pro-orbit-ring">`)
		items := arr(p, "items")
		n := len(items)
		if n == 0 {
			n = 1
		}
		for i, it := range items {
			if m, ok := it.(map[string]any); ok {
				angle := 360.0 / float64(n) * float64(i)
				fmt.Fprintf(b,
					`<div class="wb-pro-orbit-item" style="transform:rotate(%.2fdeg) translateY(-160px) rotate(%.2fdeg)"><span>%s</span></div>`,
					angle, -angle, esc(str(m, "icon")))
			}
		}
		b.WriteString(`</div></div></section>`)

	case "Form":
		// Connected form (backed by DB) tidak bisa berfungsi di static export —
		// butuh API kita untuk submit ke database + kirim notifikasi email.
		// Render placeholder informatif supaya layout tidak kosong.
		b.WriteString(`<section class="wb-form-placeholder">`)
		if t := str(p, "title"); t != "" {
			fmt.Fprintf(b, `<h3>%s</h3>`, esc(t))
		}
		if s := str(p, "subtitle"); s != "" {
			fmt.Fprintf(b, `<p>%s</p>`, esc(s))
		}
		b.WriteString(`<div class="wb-form-placeholder-note">Form ini hanya aktif pada versi online — submit butuh backend Web Builder.</div>`)
		b.WriteString(`</section>`)

	// Blok dinamis di-handle di sini (bukan hanya di level atas) supaya tetap
	// jalan saat di-nest di dalam Container/Columns.
	case "ProductGridDynamic":
		renderProductGridDynamic(b, blk, d.productList())

	case "BlogListDynamic":
		renderBlogListDynamic(b, blk, d.postList())

	default:
		if renderProBlock(b, blk) {
			return
		}
		if renderUmkmBlock(b, blk, d) {
			return
		}
		// Unknown block (incl. retired Guru* blocks on old sites): emit only a
		// comment marker so the page still renders and the warning file lists it.
		fmt.Fprintf(b, `<!-- block:%s -->`, esc(blk.Type))
	}
}

func (d *siteData) productList() []products.Product {
	if d == nil {
		return nil
	}
	return d.products
}

func (d *siteData) postList() []blog.Post {
	if d == nil {
		return nil
	}
	return d.posts
}

// ---- helpers ----

func str(m map[string]any, k string) string {
	if m == nil {
		return ""
	}
	if v, ok := m[k]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

func strOr(m map[string]any, k, def string) string {
	if s := str(m, k); s != "" {
		return s
	}
	return def
}

func intOr(m map[string]any, k string, def int) int {
	if m == nil {
		return def
	}
	if v, ok := m[k]; ok {
		if n, ok := v.(float64); ok {
			return int(n)
		}
	}
	return def
}

func arr(m map[string]any, k string) []any {
	if m == nil {
		return nil
	}
	if v, ok := m[k]; ok {
		if a, ok := v.([]any); ok {
			return a
		}
	}
	return nil
}

func esc(s string) string { return stdhtml.EscapeString(s) }

func escAttr(s string) string { return stdhtml.EscapeString(s) }

func escMultiline(s string) string {
	return strings.ReplaceAll(stdhtml.EscapeString(s), "\n", "<br/>")
}

// renderMarkdown converts markdown body to HTML using gomarkdown.
// We re-create parser/renderer per call because they're stateful; cheap to allocate.
//
// XSS hardening: SkipHTML drops raw HTML in markdown source. This mirrors the
// renderer's marked configuration. User markdown can never inject <script>,
// <iframe>, or event handlers into the static export.
func renderMarkdown(md string) string {
	p := parser.NewWithExtensions(parser.CommonExtensions | parser.AutoHeadingIDs | parser.NoEmptyLineBeforeBlock)
	r := mdhtml.NewRenderer(mdhtml.RendererOptions{
		Flags: mdhtml.CommonFlags | mdhtml.HrefTargetBlank | mdhtml.SkipHTML,
	})
	out := markdown.Render(p.Parse([]byte(md)), r)
	return string(out)
}

// formatPriceIDR matches the renderer's behaviour.
func formatPriceIDR(price int64, currency string) string {
	switch currency {
	case "IDR", "":
		return "Rp " + thousands(price)
	default:
		return currency + " " + thousands(price)
	}
}

func thousands(n int64) string {
	s := fmt.Sprintf("%d", n)
	if len(s) <= 3 {
		return s
	}
	out := []byte{}
	rem := len(s) % 3
	if rem > 0 {
		out = append(out, s[:rem]...)
		if len(s) > rem {
			out = append(out, '.')
		}
	}
	for i := rem; i < len(s); i += 3 {
		out = append(out, s[i:i+3]...)
		if i+3 < len(s) {
			out = append(out, '.')
		}
	}
	return string(out)
}

func renderProductGridDynamic(b *strings.Builder, blk Block, prods []products.Product) {
	p := blk.Props
	limit := intOr(p, "limit", 12)
	b.WriteString(`<section class="wb-products">`)
	if t := str(p, "title"); t != "" {
		fmt.Fprintf(b, `<h3>%s</h3>`, esc(t))
	}
	if len(prods) == 0 {
		b.WriteString(`<p class="wb-empty">Belum ada produk.</p></section>`)
		return
	}
	b.WriteString(`<div class="wb-grid wb-grid-3">`)
	n := len(prods)
	if n > limit {
		n = limit
	}
	for _, pr := range prods[:n] {
		fmt.Fprintf(b, `<a class="wb-product" href="/produk/%s/index.html">`, esc(pr.Slug))
		if pr.ImageURL != "" {
			fmt.Fprintf(b, `<img src="%s" alt="%s" loading="lazy" decoding="async" />`, escAttr(pr.ImageURL), escAttr(pr.Name))
		} else {
			b.WriteString(`<div class="wb-product-img-placeholder"></div>`)
		}
		b.WriteString(`<div class="wb-product-body">`)
		fmt.Fprintf(b, `<div class="wb-product-name">%s</div>`, esc(pr.Name))
		fmt.Fprintf(b, `<div class="wb-product-price">%s</div>`, esc(formatPriceIDR(pr.Price, pr.Currency)))
		b.WriteString(`</div></a>`)
	}
	b.WriteString(`</div></section>`)
}

func renderBlogListDynamic(b *strings.Builder, blk Block, posts []blog.Post) {
	p := blk.Props
	limit := intOr(p, "limit", 10)
	b.WriteString(`<section class="wb-bloglist">`)
	if t := str(p, "title"); t != "" {
		fmt.Fprintf(b, `<h3>%s</h3>`, esc(t))
	}
	if len(posts) == 0 {
		b.WriteString(`<p class="wb-empty">Belum ada artikel.</p></section>`)
		return
	}
	n := len(posts)
	if n > limit {
		n = limit
	}
	for _, post := range posts[:n] {
		fmt.Fprintf(b, `<a class="wb-blog-item" href="/blog/%s/index.html">`, esc(post.Slug))
		fmt.Fprintf(b, `<h3>%s</h3>`, esc(post.Title))
		if post.Excerpt != "" {
			fmt.Fprintf(b, `<p>%s</p>`, esc(post.Excerpt))
		}
		b.WriteString(`</a>`)
	}
	b.WriteString(`</section>`)
}

// renderProductHTML produces a standalone product detail page.
func renderProductHTML(site *sites.Site, pr products.Product, headerBlocks, footerBlocks []Block, d *siteData) string {
	var body strings.Builder
	renderLayoutBlocks(&body, headerBlocks, d)
	body.WriteString(`<main class="wb-detail">`)
	body.WriteString(`<nav class="wb-breadcrumb"><a href="/index.html">← Beranda</a></nav>`)
	body.WriteString(`<div class="wb-detail-grid">`)

	// Image
	body.WriteString(`<div>`)
	if pr.ImageURL != "" {
		fmt.Fprintf(&body, `<img src="%s" alt="%s" class="wb-detail-img" fetchpriority="high" decoding="async" />`, escAttr(pr.ImageURL), escAttr(pr.Name))
	} else {
		body.WriteString(`<div class="wb-detail-img-placeholder"></div>`)
	}
	// Gallery
	var gallery []string
	_ = json.Unmarshal(pr.Gallery, &gallery)
	if len(gallery) > 0 {
		body.WriteString(`<div class="wb-detail-gallery">`)
		for _, url := range gallery {
			fmt.Fprintf(&body, `<img src="%s" alt="" loading="lazy" decoding="async" />`, escAttr(url))
		}
		body.WriteString(`</div>`)
	}
	body.WriteString(`</div>`)

	// Info
	body.WriteString(`<div>`)
	if pr.Category != "" {
		fmt.Fprintf(&body, `<p class="wb-detail-category">%s</p>`, esc(pr.Category))
	}
	fmt.Fprintf(&body, `<h1 class="wb-detail-title">%s</h1>`, esc(pr.Name))
	fmt.Fprintf(&body, `<p class="wb-detail-price">%s</p>`, esc(formatPriceIDR(pr.Price, pr.Currency)))
	if pr.Stock != nil {
		if *pr.Stock > 0 {
			fmt.Fprintf(&body, `<p class="wb-detail-stock">Stok: %d</p>`, *pr.Stock)
		} else {
			body.WriteString(`<p class="wb-detail-stock">Stok habis</p>`)
		}
	}
	if pr.Description != "" {
		fmt.Fprintf(&body, `<div class="wb-detail-desc">%s</div>`, escMultiline(pr.Description))
	}
	body.WriteString(`</div></div></main>`)
	renderLayoutBlocks(&body, footerBlocks, d)

	return wrapHTML(site, pr.Name+" — "+site.Name, descFromText(pr.Description, 160), body.String())
}

// renderBlogPostHTML produces a standalone blog post page (markdown → HTML).
func renderBlogPostHTML(site *sites.Site, post blog.Post, headerBlocks, footerBlocks []Block, d *siteData) string {
	var body strings.Builder
	renderLayoutBlocks(&body, headerBlocks, d)
	body.WriteString(`<main class="wb-article">`)
	body.WriteString(`<nav class="wb-breadcrumb"><a href="/index.html">← Beranda</a></nav>`)
	if post.CoverImageURL != "" {
		fmt.Fprintf(&body, `<img src="%s" alt="%s" class="wb-article-cover" fetchpriority="high" decoding="async" />`, escAttr(post.CoverImageURL), escAttr(post.Title))
	}
	fmt.Fprintf(&body, `<h1 class="wb-article-title">%s</h1>`, esc(post.Title))
	body.WriteString(`<div class="wb-article-meta">`)
	if post.AuthorName != "" {
		fmt.Fprintf(&body, `<span>%s</span>`, esc(post.AuthorName))
	}
	if post.PublishedAt != nil {
		if post.AuthorName != "" {
			body.WriteString(` · `)
		}
		fmt.Fprintf(&body, `<time>%s</time>`, esc(post.PublishedAt.Format("2 January 2006")))
	}
	body.WriteString(`</div>`)
	// Tags
	var tags []string
	_ = json.Unmarshal(post.Tags, &tags)
	if len(tags) > 0 {
		body.WriteString(`<div class="wb-article-tags">`)
		for _, t := range tags {
			fmt.Fprintf(&body, `<span class="wb-tag">%s</span>`, esc(t))
		}
		body.WriteString(`</div>`)
	}
	// Body (markdown → HTML, already escaped by parser)
	fmt.Fprintf(&body, `<article class="wb-prose">%s</article>`, renderMarkdown(post.ContentMD))
	body.WriteString(`</main>`)
	renderLayoutBlocks(&body, footerBlocks, d)

	return wrapHTML(site, post.Title+" — "+site.Name, descFromText(post.Excerpt, 160), body.String())
}

// renderLayoutBlocks emits header/footer blocks from site.layout_json. Uses
// the same layout-wrap + responsive CSS pipeline as the page renderer so
// exported HTML for detail pages (product/blog) matches live output.
// No-op when blocks is empty — safe to call unconditionally.
func renderLayoutBlocks(b *strings.Builder, blocks []Block, d *siteData) {
	if len(blocks) == 0 {
		return
	}
	renderTree(b, Tree{Blocks: blocks}, d)
}

func descFromText(s string, max int) string {
	s = strings.TrimSpace(s)
	if len(s) > max {
		return s[:max]
	}
	return s
}

// wrapHTML returns a full document with shared <head> + provided body fragment.
// Inject custom head + body-end code dari site kalau ada — di-treat raw, sama
// dengan renderer (owner responsibility).
func wrapHTML(site *sites.Site, title, desc, body string) string {
	var head strings.Builder
	fmt.Fprintf(&head, `<meta charset="utf-8" />`)
	fmt.Fprintf(&head, `<meta name="viewport" content="width=device-width,initial-scale=1" />`)
	fmt.Fprintf(&head, `<title>%s</title>`, esc(title))
	if desc != "" {
		fmt.Fprintf(&head, `<meta name="description" content="%s" />`, escAttr(desc))
		fmt.Fprintf(&head, `<meta property="og:description" content="%s" />`, escAttr(desc))
	}
	fmt.Fprintf(&head, `<meta property="og:title" content="%s" />`, escAttr(title))
	head.WriteString(`<link rel="stylesheet" href="/assets/css/styles.css" />`)
	if site != nil && strings.TrimSpace(site.CustomHeadCode) != "" {
		head.WriteString(site.CustomHeadCode)
	}
	bodyEnd := ""
	if site != nil && strings.TrimSpace(site.CustomBodyEndCode) != "" {
		bodyEnd = site.CustomBodyEndCode
	}
	return fmt.Sprintf(`<!doctype html>
<html lang="id">
<head>%s</head>
<body>%s%s</body>
</html>`, head.String(), body, bodyEnd)
}
