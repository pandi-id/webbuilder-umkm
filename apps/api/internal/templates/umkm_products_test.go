package templates

import "testing"

// Seeded products must come from the variant's own showcase so the Produk menu
// and the template talk about the same goods (a batik shop got sambal before).
func TestUmkmSampleProducts_MatchVariantShowcase(t *testing.T) {
	for _, variant := range []string{"modern", "clean", "professional"} {
		items, _ := umkmBizFor(variant).Showcase["items"].([]map[string]any)
		got := umkmSampleProducts(variant)
		if len(got) == 0 || len(got) != len(items) {
			t.Fatalf("%s: got %d products, want %d", variant, len(got), len(items))
		}
		slugs := map[string]bool{}
		for i, p := range got {
			if p.Name != items[i]["name"] {
				t.Errorf("%s: product %d = %q, want showcase item %q", variant, i, p.Name, items[i]["name"])
			}
			if p.Price <= 0 || p.Status != "active" || p.Slug == "" {
				t.Errorf("%s: bad product %+v", variant, p)
			}
			if slugs[p.Slug] {
				t.Errorf("%s: duplicate slug %q", variant, p.Slug)
			}
			slugs[p.Slug] = true
		}
	}
	if p := umkmSampleProducts("modern")[0]; p.Price != 22000 {
		t.Errorf(`"Rp 22.000" parsed as %d, want 22000`, p.Price)
	}
}

// The homepage must list DB products, not a hand-typed showcase.
func TestUmkmPages_HomeUsesDynamicCatalog(t *testing.T) {
	for _, variant := range []string{"modern", "clean", "professional"} {
		var home map[string]any
		for _, pg := range umkmPages(variantCopy{}, variant) {
			if pg["is_home"] == true {
				home = pg
			}
		}
		if home == nil {
			t.Fatalf("%s: no home page", variant)
		}
		types := blockTypes(t, home)
		if !types["UmkmCatalogDynamic"] || types["UmkmProductShowcase"] {
			t.Errorf("%s: home blocks %v, want UmkmCatalogDynamic and no UmkmProductShowcase", variant, types)
		}
	}
}

func blockTypes(t *testing.T, page map[string]any) map[string]bool {
	t.Helper()
	tree, _ := page["tree"].(map[string]any)
	blocks, _ := tree["blocks"].([]map[string]any)
	if len(blocks) == 0 {
		t.Fatalf("page %v has no blocks (unexpected page shape)", page["slug"])
	}
	out := map[string]bool{}
	for _, b := range blocks {
		if s, ok := b["type"].(string); ok {
			out[s] = true
		}
	}
	return out
}
