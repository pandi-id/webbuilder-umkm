package exports

import (
	"fmt"
	"math"
	"net/url"
	"regexp"
	"strconv"
	"strings"

	"github.com/webbuilder/api/internal/products"
)

// Umkm* blocks. Markup mirrors apps/{web,renderer}/components/umkm/UmkmBlocks.tsx
// (live mode) and the CSS is the same umkm.css file, embedded in styles_umkm.go.
func renderUmkmBlock(b *strings.Builder, blk Block, d *siteData) bool {
	p := blk.Props
	switch blk.Type {
	case "UmkmHero":
		umkmHero(b, p)
	case "UmkmProductShowcase":
		umkmShowcase(b, p)
	case "UmkmCatalogDynamic":
		umkmCatalog(b, p, d.productList())
	case "UmkmPromoBanner":
		umkmPromo(b, p)
	case "UmkmStoreInfo":
		umkmStoreInfo(b, p)
	case "UmkmMarketplaceLinks":
		umkmMarketplace(b, p)
	case "UmkmTrustBadges":
		umkmTrust(b, p)
	case "UmkmReviews":
		umkmReviews(b, p)
	case "UmkmWhatsAppFloat":
		umkmWaFloat(b, p)
	default:
		return false
	}
	return true
}

// ---- helpers (ports of apps/*/lib/umkm.ts) ----

var (
	umkmNonDigit    = regexp.MustCompile(`\D`)
	umkmCentsSuffix = regexp.MustCompile(`,\d{1,2}\s*$`)
	umkmBareNumber  = regexp.MustCompile(`^\d+$`)
	umkmSafeScheme  = regexp.MustCompile(`(?i)^(https?:|mailto:|tel:|/|#|\?)`)
	umkmAnyScheme   = regexp.MustCompile(`(?i)^[a-z][a-z0-9+.\-]*:`)
	umkmMapsEmbed   = regexp.MustCompile(`(?i)^https://www\.google\.com/maps(/embed)?[/?]`)
	umkmLeadFloat   = regexp.MustCompile(`^\s*[-+]?\d+(\.\d+)?`)
	umkmAnchorStrip = regexp.MustCompile(`[^a-z0-9-]`)
)

// umkmStr also accepts numbers — template defaults store limit/rating as ints.
func umkmStr(m map[string]any, k string) string {
	switch v := m[k].(type) {
	case string:
		return v
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64)
	case int:
		return strconv.Itoa(v)
	}
	return ""
}

func umkmInt(m map[string]any, k string, def int) int {
	if n, err := strconv.Atoi(strings.TrimSpace(umkmStr(m, k))); err == nil {
		return n
	}
	return def
}

func umkmItems(p map[string]any, k string) []map[string]any {
	out := []map[string]any{}
	for _, v := range arr(p, k) {
		if m, ok := v.(map[string]any); ok {
			out = append(out, m)
		}
	}
	// Built-in templates (pre-JSON) hold []map[string]any directly.
	if raw, ok := p[k].([]map[string]any); ok {
		out = append(out, raw...)
	}
	return out
}

func umkmStrings(p map[string]any, k string) []string {
	out := []string{}
	switch v := p[k].(type) {
	case []any:
		for _, x := range v {
			s, _ := x.(string)
			out = append(out, s)
		}
	case []string:
		out = append(out, v...)
	}
	return out
}

func normalizeWaNumber(raw string) string {
	n := umkmNonDigit.ReplaceAllString(raw, "")
	if strings.HasPrefix(n, "0") {
		n = "62" + n[1:]
	} else if strings.HasPrefix(n, "8") {
		n = "62" + n
	}
	return n
}

// encodeURIComponent-compatible enough for wa.me: spaces become %20, not '+'.
func umkmURIComponent(s string) string {
	return strings.ReplaceAll(url.QueryEscape(s), "+", "%20")
}

func waLink(number, message string) string {
	out := "https://wa.me/" + normalizeWaNumber(number)
	if t := strings.TrimSpace(message); t != "" {
		out += "?text=" + umkmURIComponent(t)
	}
	return out
}

func formatRupiah(n int64) string {
	if n < 0 {
		return "-Rp " + thousands(-n)
	}
	return "Rp " + thousands(n)
}

func parsePrice(raw string) (int64, bool) {
	digits := umkmNonDigit.ReplaceAllString(umkmCentsSuffix.ReplaceAllString(raw, ""), "")
	if digits == "" {
		return 0, false
	}
	n, err := strconv.ParseInt(digits, 10, 64)
	return n, err == nil
}

func displayPrice(raw string) string {
	s := strings.TrimSpace(raw)
	if umkmBareNumber.MatchString(s) {
		if n, err := strconv.ParseInt(s, 10, 64); err == nil {
			return formatRupiah(n)
		}
	}
	return s
}

func discountPercent(price, original string) int {
	now, ok1 := parsePrice(price)
	was, ok2 := parsePrice(original)
	if !ok1 || !ok2 || was <= 0 || now >= was {
		return 0
	}
	return int(math.Round(float64(was-now) / float64(was) * 100))
}

func umkmSafeHref(raw, fallback string) string {
	s := strings.TrimSpace(raw)
	switch {
	case s == "":
		return fallback
	case umkmSafeScheme.MatchString(s):
		return s
	case umkmAnyScheme.MatchString(s):
		return fallback
	}
	return s
}

// umkmHref writes href (+ target/rel for external links), already escaped.
func umkmHref(raw string) string {
	h := umkmSafeHref(raw, "#")
	lower := strings.ToLower(h)
	if strings.HasPrefix(lower, "http://") || strings.HasPrefix(lower, "https://") {
		return fmt.Sprintf(` href="%s" target="_blank" rel="noopener noreferrer"`, escAttr(h))
	}
	return fmt.Sprintf(` href="%s"`, escAttr(h))
}

func mapEmbedSrc(src, address string) string {
	if s := strings.TrimSpace(src); s != "" {
		if umkmMapsEmbed.MatchString(s) {
			return s
		}
		return ""
	}
	if a := strings.TrimSpace(address); a != "" {
		return "https://www.google.com/maps?q=" + umkmURIComponent(a) + "&output=embed"
	}
	return ""
}

func mapDirectionsHref(address string) string {
	return "https://www.google.com/maps/search/?api=1&query=" + umkmURIComponent(strings.TrimSpace(address))
}

func telHref(phone string) string {
	s := strings.TrimSpace(phone)
	prefix := ""
	if strings.HasPrefix(s, "+") {
		prefix = "+"
	}
	return "tel:" + prefix + umkmNonDigit.ReplaceAllString(s, "")
}

func clampRating(raw string) int {
	f, err := strconv.ParseFloat(strings.TrimSpace(umkmLeadFloat.FindString(strings.Replace(raw, ",", ".", 1))), 64)
	if err != nil || f == 0 {
		return 5
	}
	n := int(math.Round(f))
	if n < 1 {
		return 1
	}
	if n > 5 {
		return 5
	}
	return n
}

func umkmInitial(name string) string {
	for _, r := range strings.TrimSpace(name) {
		return strings.ToUpper(string(r))
	}
	return "?"
}

func umkmAnchor(p map[string]any) string {
	id := umkmAnchorStrip.ReplaceAllString(strings.ToLower(umkmStr(p, "anchorId")), "")
	if id == "" {
		return ""
	}
	return fmt.Sprintf(` id="%s"`, id)
}

var umkmBadges = map[string]string{"terlaris": "Terlaris", "baru": "Baru", "promo": "Promo", "habis": "Habis"}

type umkmPlatform struct{ label, color, short string }

var umkmPlatforms = map[string]umkmPlatform{
	"shopee":     {"Shopee", "#EE4D2D", "S"},
	"tokopedia":  {"Tokopedia", "#03AC0E", "T"},
	"tiktokshop": {"TikTok Shop", "#111111", "TT"},
	"lazada":     {"Lazada", "#0F146D", "L"},
	"gofood":     {"GoFood", "#EE2737", "GF"},
	"grabfood":   {"GrabFood", "#00B14F", "G"},
	"shopeefood": {"ShopeeFood", "#EE4D2D", "SF"},
	"instagram":  {"Instagram", "#E1306C", "IG"},
	"facebook":   {"Facebook", "#1877F2", "f"},
	"website":    {"Website", "var(--color-primary)", "W"},
}

func umkmIcon(name string, small bool) string {
	inner, ok := umkmIcons[name]
	if !ok {
		inner = umkmIcons["check"]
	}
	cls := "wb-umkm-ic"
	if small {
		cls += " wb-umkm-ic--sm"
	}
	return `<svg class="` + cls + `" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` + inner + `</svg>`
}

func umkmWaIcon() string {
	return `<svg class="wb-umkm-ic" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">` + umkmWaPath + `</svg>`
}

func umkmStars(rating int) string {
	var b strings.Builder
	fmt.Fprintf(&b, `<span class="wb-umkm-stars" role="img" aria-label="%d dari 5 bintang">`, rating)
	for i := 1; i <= 5; i++ {
		cls := "wb-umkm-star"
		if i > rating {
			cls += " is-off"
		}
		fmt.Fprintf(&b, `<svg class="%s" viewBox="0 0 24 24" aria-hidden="true">%s</svg>`, cls, umkmStarPath)
	}
	b.WriteString(`</span>`)
	return b.String()
}

func umkmHead(b *strings.Builder, p map[string]any) {
	title, sub := umkmStr(p, "title"), umkmStr(p, "subtitle")
	if title == "" && sub == "" {
		return
	}
	b.WriteString(`<header class="wb-umkm-head">`)
	if title != "" {
		fmt.Fprintf(b, `<h2 class="wb-umkm-title">%s</h2>`, esc(title))
	}
	if sub != "" {
		fmt.Fprintf(b, `<p class="wb-umkm-sub">%s</p>`, esc(sub))
	}
	b.WriteString(`</header>`)
}

// ---- blocks ----

func umkmHero(b *strings.Builder, p map[string]any) {
	title := umkmStr(p, "title")
	b.WriteString(`<section class="wb-umkm wb-umkm-hero"><div class="wb-umkm-wrap wb-umkm-hero-grid"><div class="wb-umkm-hero-copy">`)
	if v := umkmStr(p, "eyebrow"); v != "" {
		fmt.Fprintf(b, `<span class="wb-umkm-eyebrow"><span class="wb-umkm-eyebrow-dot" aria-hidden="true"></span><span>%s</span></span>`, esc(v))
	}
	if title != "" {
		fmt.Fprintf(b, `<h1 class="wb-umkm-hero-title">%s</h1>`, esc(title))
	}
	if v := umkmStr(p, "subtitle"); v != "" {
		fmt.Fprintf(b, `<p class="wb-umkm-hero-sub">%s</p>`, esc(v))
	}
	cta, cta2 := umkmStr(p, "ctaLabel"), umkmStr(p, "ctaSecondaryLabel")
	if cta != "" || cta2 != "" {
		b.WriteString(`<div class="wb-umkm-actions">`)
		if cta != "" {
			fmt.Fprintf(b, `<a class="wb-umkm-btn wb-umkm-btn--primary wb-umkm-btn--lg"%s>%s<span>%s</span></a>`,
				umkmHref(waLink(umkmStr(p, "waNumber"), umkmStr(p, "waMessage"))), umkmWaIcon(), esc(cta))
		}
		if cta2 != "" {
			fmt.Fprintf(b, `<a class="wb-umkm-btn wb-umkm-btn--ghost wb-umkm-btn--lg"%s><span>%s</span></a>`,
				umkmHref(umkmStr(p, "ctaSecondaryHref")), esc(cta2))
		}
		b.WriteString(`</div>`)
	}
	chips := umkmStrings(p, "chips")
	if len(chips) > 3 {
		chips = chips[:3]
	}
	var chipHTML strings.Builder
	for _, c := range chips {
		if strings.TrimSpace(c) != "" {
			fmt.Fprintf(&chipHTML, `<li class="wb-umkm-chip">%s<span>%s</span></li>`, umkmIcon("check", true), esc(c))
		}
	}
	if chipHTML.Len() > 0 {
		fmt.Fprintf(b, `<ul class="wb-umkm-chips">%s</ul>`, chipHTML.String())
	}
	if v := umkmStr(p, "rating"); v != "" {
		fmt.Fprintf(b, `<div class="wb-umkm-rating">%s<span>%s</span></div>`, umkmStars(clampRating(v)), esc(v))
	}
	b.WriteString(`</div><div class="wb-umkm-hero-media"><div class="wb-umkm-hero-frame">`)
	if img := umkmStr(p, "image"); img != "" {
		fmt.Fprintf(b, `<img src="%s" alt="%s" />`, escAttr(img), escAttr(title))
	} else {
		fmt.Fprintf(b, `<div class="wb-umkm-ph">%s</div>`, umkmIcon("image", false))
	}
	b.WriteString(`</div></div></div></section>`)
}

type umkmCard struct {
	name, image, price, originalPrice, badge, desc, href string
	soldOut                                              bool
}

func umkmProductCard(b *strings.Builder, c umkmCard, waNumber, buttonLabel string) {
	soldOut := c.soldOut || c.badge == "habis"
	if soldOut {
		b.WriteString(`<article class="wb-umkm-card is-soldout"><div class="wb-umkm-card-media">`)
	} else {
		b.WriteString(`<article class="wb-umkm-card"><div class="wb-umkm-card-media">`)
	}
	// Mirror of ProductCard in UmkmBlocks.tsx: the image links to the product
	// page whenever the card has one, so the whole tile is clickable.
	media := fmt.Sprintf(`<div class="wb-umkm-ph">%s</div>`, umkmIcon("image", false))
	if c.image != "" {
		media = fmt.Sprintf(`<img src="%s" alt="%s" loading="lazy" decoding="async" />`, escAttr(c.image), escAttr(c.name))
	}
	if c.href != "" {
		fmt.Fprintf(b, `<a class="wb-umkm-card-link" href="%s" tabindex="-1" aria-hidden="true">%s</a>`,
			escAttr(umkmSafeHref(c.href, "#")), media)
	} else {
		b.WriteString(media)
	}
	if label, ok := umkmBadges[c.badge]; ok {
		fmt.Fprintf(b, `<span class="wb-umkm-badge wb-umkm-badge--%s">%s</span>`, c.badge, label)
	}
	if !soldOut {
		if d := discountPercent(c.price, c.originalPrice); d > 0 {
			fmt.Fprintf(b, `<span class="wb-umkm-disc">-%d%%</span>`, d)
		}
	}
	b.WriteString(`</div><div class="wb-umkm-card-body">`)
	if c.href != "" {
		fmt.Fprintf(b, `<h3 class="wb-umkm-card-name"><a href="%s">%s</a></h3>`, escAttr(umkmSafeHref(c.href, "#")), esc(c.name))
	} else if c.name != "" {
		fmt.Fprintf(b, `<h3 class="wb-umkm-card-name">%s</h3>`, esc(c.name))
	}
	if c.desc != "" {
		fmt.Fprintf(b, `<p class="wb-umkm-card-desc">%s</p>`, esc(c.desc))
	}
	b.WriteString(`<div class="wb-umkm-price">`)
	if v := displayPrice(c.price); v != "" {
		fmt.Fprintf(b, `<span class="wb-umkm-price-now">%s</span>`, esc(v))
	}
	if v := displayPrice(c.originalPrice); v != "" {
		fmt.Fprintf(b, `<span class="wb-umkm-price-was">%s</span>`, esc(v))
	}
	b.WriteString(`</div>`)
	if soldOut {
		b.WriteString(`<span class="wb-umkm-btn wb-umkm-btn--sm wb-umkm-btn--block wb-umkm-card-cta is-disabled">Stok habis</span>`)
	} else {
		fmt.Fprintf(b, `<a class="wb-umkm-btn wb-umkm-btn--primary wb-umkm-btn--sm wb-umkm-btn--block wb-umkm-card-cta" aria-label="%s"%s>%s<span>%s</span></a>`,
			escAttr(buttonLabel+" "+c.name+" via WhatsApp"),
			umkmHref(waLink(waNumber, "Halo, saya mau pesan "+c.name)), umkmWaIcon(), esc(buttonLabel))
	}
	b.WriteString(`</div></article>`)
}

func umkmGridClass(p map[string]any) string {
	if umkmStr(p, "columns") == "3" {
		return "wb-umkm-grid"
	}
	return "wb-umkm-grid wb-umkm-grid--4"
}

func umkmShowcase(b *strings.Builder, p map[string]any) {
	waNumber := umkmStr(p, "waNumber")
	label := strOr(p, "buttonLabel", "Pesan")
	fmt.Fprintf(b, `<section class="wb-umkm wb-umkm-showcase"%s><div class="wb-umkm-wrap">`, umkmAnchor(p))
	umkmHead(b, p)
	fmt.Fprintf(b, `<div class="%s">`, umkmGridClass(p))
	for _, it := range umkmItems(p, "items") {
		umkmProductCard(b, umkmCard{
			name: umkmStr(it, "name"), image: umkmStr(it, "image"), price: umkmStr(it, "price"),
			originalPrice: umkmStr(it, "originalPrice"), badge: umkmStr(it, "badge"), desc: umkmStr(it, "desc"),
		}, waNumber, label)
	}
	b.WriteString(`</div></div></section>`)
}

var umkmMarkdownChars = regexp.MustCompile("[#*_`>\\[\\]]")

func umkmCatalog(b *strings.Builder, p map[string]any, prods []products.Product) {
	limit := umkmInt(p, "limit", 8)
	if limit < 1 {
		limit = 1
	}
	if limit > 48 {
		limit = 48
	}
	category := strings.ToLower(strings.TrimSpace(umkmStr(p, "category")))
	showSoldOut := umkmStr(p, "showOutOfStock") == "yes"
	waNumber := umkmStr(p, "waNumber")
	label := strOr(p, "buttonLabel", "Pesan")

	fmt.Fprintf(b, `<section class="wb-umkm wb-umkm-catalog"%s><div class="wb-umkm-wrap">`, umkmAnchor(p))
	umkmHead(b, p)
	var cards strings.Builder
	n := 0
	for _, pr := range prods {
		if n >= limit {
			break
		}
		if category != "" && strings.ToLower(strings.TrimSpace(pr.Category)) != category {
			continue
		}
		soldOut := pr.Stock != nil && *pr.Stock <= 0
		if soldOut && !showSoldOut {
			continue
		}
		price := formatPriceIDR(pr.Price, pr.Currency)
		if pr.Currency == "" || pr.Currency == "IDR" {
			price = formatRupiah(pr.Price)
		}
		desc := []rune(umkmMarkdownChars.ReplaceAllString(pr.Description, ""))
		if len(desc) > 160 {
			desc = desc[:160]
		}
		badge := ""
		if soldOut {
			badge = "habis"
		}
		umkmProductCard(&cards, umkmCard{
			name: pr.Name, image: pr.ImageURL, price: price, badge: badge, desc: string(desc),
			href: "/produk/" + pr.Slug + "/index.html", soldOut: soldOut,
		}, waNumber, label)
		n++
	}
	if n == 0 {
		b.WriteString(`<p class="wb-umkm-empty">Produk segera hadir. Hubungi kami untuk info stok terbaru.</p>`)
	} else {
		fmt.Fprintf(b, `<div class="%s">%s</div>`, umkmGridClass(p), cards.String())
	}
	b.WriteString(`</div></section>`)
}

func umkmPromo(b *strings.Builder, p map[string]any) {
	headline, code, waNumber := umkmStr(p, "headline"), umkmStr(p, "voucherCode"), umkmStr(p, "waNumber")
	href := strOr(p, "ctaHref", "#")
	if waNumber != "" {
		msg := "Halo, saya mau tanya promo " + headline
		if code != "" {
			msg = "Halo, saya mau pakai kode voucher " + code
		}
		href = waLink(waNumber, msg)
	}
	b.WriteString(`<section class="wb-umkm wb-umkm-promo"><div class="wb-umkm-wrap"><div class="wb-umkm-promo-card"><div class="wb-umkm-promo-main">`)
	if v := umkmStr(p, "discountLabel"); v != "" {
		fmt.Fprintf(b, `<span class="wb-umkm-promo-tag">%s<span>%s</span></span>`, umkmIcon("tag", true), esc(v))
	}
	if headline != "" {
		fmt.Fprintf(b, `<h2 class="wb-umkm-promo-title">%s</h2>`, esc(headline))
	}
	if v := umkmStr(p, "description"); v != "" {
		fmt.Fprintf(b, `<p class="wb-umkm-promo-desc">%s</p>`, esc(v))
	}
	if v := umkmStr(p, "validUntil"); v != "" {
		fmt.Fprintf(b, `<p class="wb-umkm-promo-valid">%s<span>%s</span></p>`, umkmIcon("clock", true), esc(v))
	}
	b.WriteString(`</div>`)
	cta := umkmStr(p, "ctaLabel")
	if code != "" || cta != "" {
		b.WriteString(`<div class="wb-umkm-promo-side">`)
		if code != "" {
			// Static export: no JS copy button, the code stays selectable text.
			fmt.Fprintf(b, `<div class="wb-umkm-voucher"><span class="wb-umkm-voucher-label">Kode voucher</span><div class="wb-umkm-voucher-row"><span class="wb-umkm-voucher-code">%s</span></div></div>`, esc(code))
		}
		if cta != "" {
			icon := ""
			if waNumber != "" {
				icon = umkmWaIcon()
			}
			fmt.Fprintf(b, `<a class="wb-umkm-btn wb-umkm-btn--light wb-umkm-btn--lg wb-umkm-btn--block"%s>%s<span>%s</span></a>`,
				umkmHref(href), icon, esc(cta))
		}
		b.WriteString(`</div>`)
	}
	b.WriteString(`</div></div></section>`)
}

func umkmInfoRow(b *strings.Builder, icon, label, body string) {
	fmt.Fprintf(b, `<div class="wb-umkm-info-row"><span class="wb-umkm-info-ic">%s</span><div class="wb-umkm-info-body"><div class="wb-umkm-info-label">%s</div>%s</div></div>`,
		umkmIcon(icon, false), label, body)
}

func umkmStoreInfo(b *strings.Builder, p map[string]any) {
	address, phone, waNumber, email := umkmStr(p, "address"), umkmStr(p, "phone"), umkmStr(p, "waNumber"), umkmStr(p, "email")
	directions := mapDirectionsHref(address)
	fmt.Fprintf(b, `<section class="wb-umkm wb-umkm-store"%s><div class="wb-umkm-wrap">`, umkmAnchor(p))
	umkmHead(b, p)
	b.WriteString(`<div class="wb-umkm-store-grid"><div class="wb-umkm-store-info">`)
	if address != "" {
		umkmInfoRow(b, "pin", "Alamat", fmt.Sprintf(`<p class="wb-umkm-info-text">%s</p><a class="wb-umkm-link"%s>Petunjuk arah%s</a>`,
			esc(address), umkmHref(directions), umkmIcon("arrow", true)))
	}
	if hours := umkmItems(p, "hours"); len(hours) > 0 {
		var h strings.Builder
		h.WriteString(`<ul class="wb-umkm-hours">`)
		for _, it := range hours {
			fmt.Fprintf(&h, `<li><span class="wb-umkm-hours-day">%s</span><span class="wb-umkm-hours-time">%s</span></li>`,
				esc(umkmStr(it, "day")), esc(umkmStr(it, "hours")))
		}
		h.WriteString(`</ul>`)
		umkmInfoRow(b, "clock", "Jam buka", h.String())
	}
	if phone != "" || waNumber != "" {
		var c strings.Builder
		if phone != "" {
			fmt.Fprintf(&c, `<p class="wb-umkm-info-text">%s</p>`, esc(phone))
		}
		c.WriteString(`<div class="wb-umkm-contact-actions">`)
		if waNumber != "" {
			fmt.Fprintf(&c, `<a class="wb-umkm-btn wb-umkm-btn--primary wb-umkm-btn--sm"%s>%s<span>Chat WhatsApp</span></a>`,
				umkmHref(waLink(waNumber, umkmStr(p, "waMessage"))), umkmWaIcon())
		}
		if phone != "" {
			fmt.Fprintf(&c, `<a class="wb-umkm-btn wb-umkm-btn--ghost wb-umkm-btn--sm"%s>%s<span>Telepon</span></a>`,
				umkmHref(telHref(phone)), umkmIcon("phone", true))
		}
		c.WriteString(`</div>`)
		umkmInfoRow(b, "phone", "Telepon &amp; WhatsApp", c.String())
	}
	if email != "" {
		umkmInfoRow(b, "mail", "Email", fmt.Sprintf(`<a class="wb-umkm-link"%s><span>%s</span></a>`, umkmHref("mailto:"+email), esc(email)))
	}
	var areas strings.Builder
	for _, a := range umkmStrings(p, "areas") {
		if strings.TrimSpace(a) != "" {
			fmt.Fprintf(&areas, `<li class="wb-umkm-area"><span>%s</span></li>`, esc(a))
		}
	}
	if areas.Len() > 0 {
		umkmInfoRow(b, "delivery", "Area pengiriman", `<ul class="wb-umkm-areas">`+areas.String()+`</ul>`)
	}
	b.WriteString(`</div>`)
	if umkmStr(p, "showMap") != "no" {
		b.WriteString(`<div class="wb-umkm-store-map">`)
		if embed := mapEmbedSrc(umkmStr(p, "mapSrc"), address); embed != "" {
			fmt.Fprintf(b, `<iframe src="%s" title="%s" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen></iframe>`,
				escAttr(embed), escAttr(strings.TrimSpace("Peta lokasi "+umkmStr(p, "title"))))
		} else {
			fmt.Fprintf(b, `<div class="wb-umkm-map-ph">%s<p class="wb-umkm-sub">%s</p>`, umkmIcon("pin", false), esc(strOr(p, "address", "Lokasi toko")))
			if address != "" {
				fmt.Fprintf(b, `<a class="wb-umkm-link"%s>Buka di Google Maps%s</a>`, umkmHref(directions), umkmIcon("external", true))
			}
			b.WriteString(`</div>`)
		}
		b.WriteString(`</div>`)
	}
	b.WriteString(`</div></div></section>`)
}

func umkmMarketplace(b *strings.Builder, p map[string]any) {
	b.WriteString(`<section class="wb-umkm wb-umkm-mp"><div class="wb-umkm-wrap">`)
	umkmHead(b, p)
	b.WriteString(`<div class="wb-umkm-mp-list">`)
	for _, it := range umkmItems(p, "items") {
		pf, ok := umkmPlatforms[umkmStr(it, "platform")]
		if !ok {
			pf = umkmPlatforms["website"]
		}
		fmt.Fprintf(b, `<a class="wb-umkm-mp-pill"%s><span class="wb-umkm-mp-dot" style="background:%s" aria-hidden="true">%s</span><span class="wb-umkm-mp-text"><span class="wb-umkm-mp-name">%s</span>`,
			umkmHref(umkmStr(it, "url")), pf.color, pf.short, pf.label)
		if l := umkmStr(it, "label"); l != "" {
			fmt.Fprintf(b, `<span class="wb-umkm-mp-label">%s</span>`, esc(l))
		}
		fmt.Fprintf(b, `</span>%s</a>`, umkmIcon("external", true))
	}
	b.WriteString(`</div></div></section>`)
}

func umkmTrust(b *strings.Builder, p map[string]any) {
	b.WriteString(`<section class="wb-umkm wb-umkm-trust"><div class="wb-umkm-wrap">`)
	umkmHead(b, p)
	b.WriteString(`<ul class="wb-umkm-trust-grid">`)
	for _, it := range umkmItems(p, "items") {
		fmt.Fprintf(b, `<li class="wb-umkm-trust-item"><span class="wb-umkm-trust-ic">%s</span>`, umkmIcon(umkmStr(it, "icon"), false))
		if t := umkmStr(it, "title"); t != "" {
			fmt.Fprintf(b, `<h3 class="wb-umkm-trust-title">%s</h3>`, esc(t))
		}
		if d := umkmStr(it, "desc"); d != "" {
			fmt.Fprintf(b, `<p class="wb-umkm-trust-desc">%s</p>`, esc(d))
		}
		b.WriteString(`</li>`)
	}
	b.WriteString(`</ul></div></section>`)
}

func umkmReviews(b *strings.Builder, p map[string]any) {
	title, sub, avg, count := umkmStr(p, "title"), umkmStr(p, "subtitle"), umkmStr(p, "average"), umkmStr(p, "countText")
	b.WriteString(`<section class="wb-umkm wb-umkm-reviews"><div class="wb-umkm-wrap"><header class="wb-umkm-head">`)
	if title != "" {
		fmt.Fprintf(b, `<h2 class="wb-umkm-title">%s</h2>`, esc(title))
	}
	if sub != "" {
		fmt.Fprintf(b, `<p class="wb-umkm-sub">%s</p>`, esc(sub))
	}
	if avg != "" || count != "" {
		fmt.Fprintf(b, `<div class="wb-umkm-rev-summary"><span class="wb-umkm-rev-avg">%s</span><span class="wb-umkm-rev-meta">%s<span>%s</span></span></div>`,
			esc(avg), umkmStars(clampRating(avg)), esc(count))
	}
	b.WriteString(`</header><div class="wb-umkm-rev-list">`)
	for _, it := range umkmItems(p, "items") {
		name, photo := umkmStr(it, "name"), umkmStr(it, "photo")
		fmt.Fprintf(b, `<figure class="wb-umkm-rev">%s<p class="wb-umkm-rev-text">%s</p><figcaption class="wb-umkm-rev-author"><span class="wb-umkm-avatar">`,
			umkmStars(clampRating(umkmStr(it, "rating"))), esc(umkmStr(it, "text")))
		if photo != "" {
			fmt.Fprintf(b, `<img src="%s" alt="%s" loading="lazy" decoding="async" />`, escAttr(photo), escAttr(name))
		} else {
			b.WriteString(esc(umkmInitial(name)))
		}
		fmt.Fprintf(b, `</span><div><div class="wb-umkm-rev-name">%s</div>`, esc(name))
		if loc := umkmStr(it, "location"); loc != "" {
			fmt.Fprintf(b, `<div class="wb-umkm-rev-loc">%s</div>`, esc(loc))
		}
		b.WriteString(`</div></figcaption></figure>`)
	}
	b.WriteString(`</div></div></section>`)
}

func umkmWaFloat(b *strings.Builder, p map[string]any) {
	label := umkmStr(p, "label")
	cls := "wb-umkm-wa-float"
	if umkmStr(p, "position") == "left" {
		cls += " wb-umkm-wa-float--left"
	}
	if umkmStr(p, "color") == "theme" {
		cls += " wb-umkm-wa-float--theme"
	}
	aria := "Chat via WhatsApp"
	if label != "" {
		aria = label + " via WhatsApp"
	}
	fmt.Fprintf(b, `<div class="%s">`, cls)
	if label != "" {
		fmt.Fprintf(b, `<span class="wb-umkm-wa-bubble">%s</span>`, esc(label))
	}
	fmt.Fprintf(b, `<a class="wb-umkm-wa-fab" aria-label="%s"%s><svg viewBox="0 0 24 24" aria-hidden="true">%s</svg></a></div>`,
		escAttr(aria), umkmHref(waLink(umkmStr(p, "waNumber"), umkmStr(p, "waMessage"))), umkmWaPath)
}

// Generated from apps/renderer/lib/umkm.ts — keep in sync.
var umkmIcons = map[string]string{
	"halal":     `<path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"/><path d="m9 12 2 2 4-4"/>`,
	"pirt":      `<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="m9 15 2 2 4-4"/>`,
	"bpom":      `<path d="M10 2v7.53a2 2 0 0 1-.21.9L4.72 20.55a1 1 0 0 0 .9 1.45h12.76a1 1 0 0 0 .9-1.45l-5.07-10.12A2 2 0 0 1 14 9.53V2"/><path d="M8.5 2h7"/><path d="M7 16h10"/>`,
	"sni":       `<circle cx="12" cy="8" r="6"/><path d="M15.48 12.89 17 22l-5-3-5 3 1.52-9.11"/>`,
	"qris":      `<rect width="5" height="5" x="3" y="3" rx="1"/><rect width="5" height="5" x="16" y="3" rx="1"/><rect width="5" height="5" x="3" y="16" rx="1"/><path d="M21 16h-3a2 2 0 0 0-2 2v3"/><path d="M21 21v.01"/><path d="M12 7v3a2 2 0 0 1-2 2H7"/><path d="M3 12h.01"/><path d="M12 3h.01"/><path d="M12 16v.01"/><path d="M16 12h1"/><path d="M21 12v.01"/><path d="M12 21v-1"/>`,
	"cod":       `<rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>`,
	"transfer":  `<path d="M3 22h18"/><path d="M6 18v-7"/><path d="M10 18v-7"/><path d="M14 18v-7"/><path d="M18 18v-7"/><path d="M12 2 20 7H4z"/>`,
	"delivery":  `<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>`,
	"guarantee": `<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>`,
	"handmade":  `<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>`,
	"pin":       `<path d="M20 10c0 5-5.54 10.19-7.4 11.8a1 1 0 0 1-1.2 0C9.54 20.19 4 15 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>`,
	"clock":     `<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>`,
	"phone":     `<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>`,
	"mail":      `<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>`,
	"check":     `<path d="M20 6 9 17l-5-5"/>`,
	"tag":       `<path d="M12.59 2.59A2 2 0 0 0 11.17 2H4a2 2 0 0 0-2 2v7.17a2 2 0 0 0 .59 1.42l8.7 8.7a2.43 2.43 0 0 0 3.42 0l6.58-6.58a2.43 2.43 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r="1"/>`,
	"image":     `<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21"/>`,
	"arrow":     `<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>`,
	"copy":      `<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>`,
	"external":  `<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>`,
}

const umkmWaPath = `<path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.16-.17.2-.35.22-.64.07-.3-.15-1.26-.46-2.39-1.47-.88-.79-1.48-1.76-1.65-2.06-.17-.3-.02-.46.13-.6.13-.14.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.61-.92-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.21 3.07c.15.2 2.1 3.2 5.08 4.49.71.3 1.26.49 1.7.63.71.22 1.36.19 1.87.12.57-.09 1.76-.72 2-1.42.25-.69.25-1.29.18-1.41-.08-.13-.27-.2-.57-.35m-5.42 7.4h-.01a9.87 9.87 0 0 1-5.03-1.38l-.36-.21-3.74.98 1-3.65-.24-.37a9.86 9.86 0 0 1-1.51-5.26c0-5.45 4.44-9.88 9.89-9.88 2.64 0 5.12 1.03 6.99 2.9a9.83 9.83 0 0 1 2.89 6.99c0 5.45-4.44 9.89-9.88 9.89m8.41-18.3A11.82 11.82 0 0 0 12.05 0C5.5 0 .16 5.34.16 11.89c0 2.1.55 4.14 1.59 5.95L.06 24l6.3-1.65a11.88 11.88 0 0 0 5.68 1.45h.01c6.55 0 11.89-5.34 11.89-11.89a11.82 11.82 0 0 0-3.48-8.41Z"/>`

const umkmStarPath = `<path d="M12 2.5l2.94 5.96 6.56.95-4.75 4.63 1.12 6.54L12 17.5l-5.87 3.08 1.12-6.54L2.5 9.41l6.56-.95z"/>`
