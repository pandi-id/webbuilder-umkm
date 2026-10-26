package sites

import (
	"encoding/json"
)

// LayoutJSON — shape yang disimpan di sites.layout_json. Semua field optional
// untuk backward compat: layout kosong `{}` = renderer skip prepend/append.
type LayoutJSON struct {
	Header        []json.RawMessage `json:"header,omitempty"`
	Footer        []json.RawMessage `json:"footer,omitempty"`
	HeaderEnabled bool              `json:"header_enabled"`
	FooterEnabled bool              `json:"footer_enabled"`
}

// headerBlockTypes / footerBlockTypes — jenis block yang dianggap header/footer
// oleh extractor. Konsisten dengan migrasi 0057 supaya extraction dari template
// = extraction dari home page existing site.
var (
	headerBlockTypes = map[string]bool{
		"Navbar": true,
	}
	footerBlockTypes = map[string]bool{
		"Footer": true,
	}
)

type pageTree struct {
	Blocks []json.RawMessage `json:"blocks"`
}

// blockTypeOf peek `.type` dari raw block JSON tanpa full unmarshal. Return
// "" kalau JSON invalid atau tidak punya field type.
func blockTypeOf(raw json.RawMessage) string {
	var probe struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(raw, &probe); err != nil {
		return ""
	}
	return probe.Type
}

// ExtractLayoutFromPagesJSON walks a slice of template pages, detects the
// home page's leading header + trailing footer, and returns:
//   - layout JSON with header/footer + enabled flags (nil kalau tidak ada
//     apa-apa untuk di-extract)
//   - stripped pages array where header/footer di-hapus dari SEMUA pages
//     (bukan cuma home) — supaya renderer tidak render dua kali setelah
//     shared layout aktif.
//
// Kalau home page tidak ada, atau tidak ada header/footer terdeteksi, return
// original pages tanpa modifikasi + layout=nil.
//
// Konsisten dengan migration 0057: same detection rules, same behaviour.
func ExtractLayoutFromPagesJSON(pagesJSON json.RawMessage) (json.RawMessage, json.RawMessage, error) {
	if len(pagesJSON) == 0 {
		return nil, pagesJSON, nil
	}

	// Preserve original structure — tiap page bisa punya field tambahan (SEO,
	// is_home, etc.). Kita hanya rewrite `tree.blocks`. Pakai raw map supaya
	// field lain lolos apa adanya.
	var pages []map[string]json.RawMessage
	if err := json.Unmarshal(pagesJSON, &pages); err != nil {
		return nil, pagesJSON, err
	}
	if len(pages) == 0 {
		return nil, pagesJSON, nil
	}

	// Find home page (is_home=true). Fallback: first page.
	homeIdx := -1
	for i, p := range pages {
		var isHome bool
		if raw, ok := p["is_home"]; ok {
			_ = json.Unmarshal(raw, &isHome)
		}
		if isHome {
			homeIdx = i
			break
		}
	}
	if homeIdx < 0 {
		homeIdx = 0
	}

	homeBlocks := blocksFromPage(pages[homeIdx])
	if len(homeBlocks) == 0 {
		return nil, pagesJSON, nil
	}

	headerEnd := 0
	for headerEnd < len(homeBlocks) && headerBlockTypes[blockTypeOf(homeBlocks[headerEnd])] {
		headerEnd++
	}
	footerStart := len(homeBlocks)
	for footerStart > headerEnd && footerBlockTypes[blockTypeOf(homeBlocks[footerStart-1])] {
		footerStart--
	}

	if headerEnd == 0 && footerStart == len(homeBlocks) {
		// Tidak ada header/footer di home — tidak perlu extract.
		return nil, pagesJSON, nil
	}

	headerBlocks := append([]json.RawMessage(nil), homeBlocks[:headerEnd]...)
	footerBlocks := append([]json.RawMessage(nil), homeBlocks[footerStart:]...)

	// Strip header/footer dari SEMUA pages (bukan cuma home) supaya tidak
	// double render setelah layout aktif.
	stripped := make([]map[string]json.RawMessage, len(pages))
	for i, p := range pages {
		clone := make(map[string]json.RawMessage, len(p))
		for k, v := range p {
			clone[k] = v
		}
		blks := blocksFromPage(clone)
		if len(blks) > 0 {
			blks = stripLayoutBlocks(blks)
			clone["tree"] = mustMarshal(pageTree{Blocks: blks})
		}
		stripped[i] = clone
	}

	layout := LayoutJSON{
		Header:        headerBlocks,
		Footer:        footerBlocks,
		HeaderEnabled: len(headerBlocks) > 0,
		FooterEnabled: len(footerBlocks) > 0,
	}
	layoutJSON, err := json.Marshal(layout)
	if err != nil {
		return nil, pagesJSON, err
	}
	strippedJSON, err := json.Marshal(stripped)
	if err != nil {
		return nil, pagesJSON, err
	}
	return layoutJSON, strippedJSON, nil
}

// blocksFromPage peek `tree.blocks` array. Kosong kalau tree null/invalid.
func blocksFromPage(p map[string]json.RawMessage) []json.RawMessage {
	raw, ok := p["tree"]
	if !ok || len(raw) == 0 {
		return nil
	}
	var t pageTree
	if err := json.Unmarshal(raw, &t); err != nil {
		return nil
	}
	return t.Blocks
}

// stripLayoutBlocks removes leading header + trailing footer runs from a
// block array. Middle blocks preserved. Same logic as migration 0057.
func stripLayoutBlocks(blocks []json.RawMessage) []json.RawMessage {
	if len(blocks) == 0 {
		return blocks
	}
	headerEnd := 0
	for headerEnd < len(blocks) && headerBlockTypes[blockTypeOf(blocks[headerEnd])] {
		headerEnd++
	}
	footerStart := len(blocks)
	for footerStart > headerEnd && footerBlockTypes[blockTypeOf(blocks[footerStart-1])] {
		footerStart--
	}
	if headerEnd == 0 && footerStart == len(blocks) {
		return blocks
	}
	out := make([]json.RawMessage, footerStart-headerEnd)
	copy(out, blocks[headerEnd:footerStart])
	return out
}

func mustMarshal(v any) json.RawMessage {
	b, err := json.Marshal(v)
	if err != nil {
		return json.RawMessage("{}")
	}
	return b
}
