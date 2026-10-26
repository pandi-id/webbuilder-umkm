package exports

import (
	"strings"
	"testing"

	"github.com/webbuilder/api/internal/products"
)

const xssProbe = `<script>alert("x")</script>`

func TestRenderUmkmBlocks(t *testing.T) {
	stock0 := 0
	data := &siteData{products: []products.Product{
		{Slug: "kopi-aren", Name: "Kopi " + xssProbe, Price: 22000, Currency: "IDR", ImageURL: "https://cdn.test/kopi.jpg"},
		{Slug: "habis", Name: "Roti Habis", Price: 18000, Currency: "IDR", Stock: &stock0},
	}}
	cases := []struct {
		typ   string
		props map[string]any
		want  []string
	}{
		{"UmkmHero", map[string]any{
			"title": xssProbe, "ctaLabel": "Pesan", "waNumber": "0812-3456 789", "waMessage": "Halo kak",
			"chips": []any{"Halal", xssProbe}, "rating": "4.8 dari 120 pembeli",
			"ctaSecondaryLabel": "Menu", "ctaSecondaryHref": "javascript:alert(1)",
		}, []string{`class="wb-umkm wb-umkm-hero"`, `https://wa.me/628123456789?text=Halo%20kak`, `class="wb-umkm-chip"`, `aria-label="5 dari 5 bintang"`, `href="#"`}},
		{"UmkmProductShowcase", map[string]any{
			"title": "Menu", "waNumber": "0812-3456 789", "columns": "3",
			"items": []any{map[string]any{"name": xssProbe, "price": "25000", "originalPrice": "Rp 30.000", "badge": "terlaris"}},
		}, []string{`class="wb-umkm-grid"`, `Rp 25.000`, `-17%`, `wb-umkm-badge--terlaris`, `https://wa.me/628123456789?text=Halo%2C%20saya%20mau%20pesan`}},
		{"UmkmCatalogDynamic", map[string]any{"title": "Produk", "waNumber": "08123", "limit": float64(5)},
			[]string{`wb-umkm-catalog`, `Rp 22.000`, `href="/produk/kopi-aren/index.html"`}},
		{"UmkmPromoBanner", map[string]any{"headline": xssProbe, "voucherCode": "GAJIAN20", "ctaLabel": "Pakai", "waNumber": "0812-3456 789"},
			[]string{`wb-umkm-promo-card`, `<span class="wb-umkm-voucher-code">GAJIAN20</span>`, `kode%20voucher%20GAJIAN20`}},
		{"UmkmStoreInfo", map[string]any{
			"title": "Lokasi", "address": "Jl. Braga No. 21, Bandung", "phone": "+62 812-3456", "waNumber": "0812-3456 789",
			"email": "halo@toko.id", "hours": []any{map[string]any{"day": "Senin", "hours": "08.00"}}, "areas": []any{xssProbe},
		}, []string{`wb-umkm-store-grid`, `<iframe src="https://www.google.com/maps?q=Jl.%20Braga`, `href="tel:+628123456"`, `mailto:halo@toko.id`}},
		{"UmkmMarketplaceLinks", map[string]any{"items": []any{
			map[string]any{"platform": "shopee", "url": "https://shopee.co.id/x", "label": xssProbe},
			map[string]any{"platform": "unknown", "url": "javascript:alert(1)"},
		}}, []string{`wb-umkm-mp-pill`, `background:#EE4D2D`, `rel="noopener noreferrer"`, `<span class="wb-umkm-mp-name">Website</span>`}},
		{"UmkmTrustBadges", map[string]any{"items": []any{map[string]any{"icon": "halal", "title": xssProbe, "desc": "BPJPH"}}},
			[]string{`wb-umkm-trust-item`, `m9 12 2 2 4-4`}},
		{"UmkmReviews", map[string]any{"average": "4.9", "countText": "dari 10 ulasan",
			"items": []any{map[string]any{"name": xssProbe, "rating": "3", "text": "Enak"}}},
			[]string{`wb-umkm-rev-summary`, `aria-label="3 dari 5 bintang"`, `wb-umkm-avatar`}},
		{"UmkmWhatsAppFloat", map[string]any{"waNumber": "0812-3456 789", "label": xssProbe, "position": "left"},
			[]string{`class="wb-umkm-wa-float wb-umkm-wa-float--left"`, `https://wa.me/628123456789`}},
	}
	seen := map[string]bool{}
	for _, tc := range cases {
		seen[tc.typ] = true
		t.Run(tc.typ, func(t *testing.T) {
			var b strings.Builder
			renderBlock(&b, Block{Type: tc.typ, Props: tc.props}, data)
			out := b.String()
			if out == "" || strings.HasPrefix(out, "<!-- block:") {
				t.Fatalf("no markup rendered: %q", out)
			}
			for _, w := range tc.want {
				if !strings.Contains(out, w) {
					t.Errorf("missing %q in output:\n%s", w, out)
				}
			}
			if strings.Contains(out, "<script>") || strings.Contains(out, "javascript:") {
				t.Errorf("unescaped user input leaked:\n%s", out)
			}
			// Empty props must still render something (fresh block from the palette).
			var empty strings.Builder
			renderBlock(&empty, Block{Type: tc.typ, Props: map[string]any{}}, nil)
			if empty.Len() == 0 || strings.HasPrefix(empty.String(), "<!-- block:") {
				t.Errorf("empty props render nothing")
			}
		})
	}
	for _, typ := range []string{"UmkmHero", "UmkmProductShowcase", "UmkmCatalogDynamic", "UmkmPromoBanner", "UmkmStoreInfo",
		"UmkmMarketplaceLinks", "UmkmTrustBadges", "UmkmReviews", "UmkmWhatsAppFloat"} {
		if !seen[typ] {
			t.Errorf("no test case for %s", typ)
		}
	}
}

func TestUmkmCatalog_HidesSoldOutUnlessAsked(t *testing.T) {
	stock0 := 0
	data := &siteData{products: []products.Product{{Slug: "a", Name: "Roti Habis", Price: 1000, Stock: &stock0}}}
	var hidden, shown strings.Builder
	renderBlock(&hidden, Block{Type: "UmkmCatalogDynamic", Props: map[string]any{}}, data)
	renderBlock(&shown, Block{Type: "UmkmCatalogDynamic", Props: map[string]any{"showOutOfStock": "yes"}}, data)
	if strings.Contains(hidden.String(), "Roti Habis") || !strings.Contains(hidden.String(), "wb-umkm-empty") {
		t.Errorf("sold-out product should be hidden by default: %s", hidden.String())
	}
	if !strings.Contains(shown.String(), "is-soldout") || !strings.Contains(shown.String(), "Stok habis") {
		t.Errorf("sold-out product should render disabled: %s", shown.String())
	}
}

func TestUmkmHelpers(t *testing.T) {
	waCases := map[string]string{
		"0812-3456 789":  "628123456789",
		"+62 812 3456":   "628123456",
		"812345":         "62812345",
		"(021) 555-0101": "62215550101",
	}
	for in, want := range waCases {
		if got := normalizeWaNumber(in); got != want {
			t.Errorf("normalizeWaNumber(%q) = %q, want %q", in, got, want)
		}
	}
	if got := waLink("0812-3456 789", ""); got != "https://wa.me/628123456789" {
		t.Errorf("waLink = %q", got)
	}
	if got := discountPercent("Rp 22.000", "Rp 28.000"); got != 21 {
		t.Errorf("discountPercent = %d, want 21", got)
	}
	if got := discountPercent("Rp 30.000", "Rp 28.000"); got != 0 {
		t.Errorf("discount when price > original = %d, want 0", got)
	}
	if got := displayPrice("1500000"); got != "Rp 1.500.000" {
		t.Errorf("displayPrice = %q", got)
	}
	if got := mapEmbedSrc("https://evil.test/maps", "x"); got != "" {
		t.Errorf("non-Google map embed allowed: %q", got)
	}
	if got := clampRating("4,6 dari 5"); got != 5 {
		t.Errorf("clampRating = %d", got)
	}
}
