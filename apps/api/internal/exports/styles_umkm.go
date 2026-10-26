package exports

import _ "embed"

// umkmCSS styles the Umkm* blocks. umkm.css is a byte-identical copy of
// apps/{web,renderer}/components/umkm/umkm.css so exports match the live site.
//
//go:embed umkm.css
var umkmCSS string
