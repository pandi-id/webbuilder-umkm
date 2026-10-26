package exports

import (
	"archive/zip"
	"bytes"
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/webbuilder/api/internal/pages"
	"github.com/webbuilder/api/internal/templates"
)

// Hasil export harus bisa dibuka langsung dari disk atau di-host di subfolder,
// bukan cuma di root domain. Versi lama menulis `/assets/css/styles.css` dan
// `/slug/` apa adanya, jadi halaman di kedalaman mana pun kehilangan CSS dan
// seluruh navigasinya.
func TestRelativize_PrefixesByDepth(t *testing.T) {
	const html = `<link href="/assets/css/styles.css" /><a href="/profil/index.html">P</a><img src="/assets/img/a.png">`

	cases := map[string][]string{
		"index.html": {
			`href="assets/css/styles.css"`, `href="profil/index.html"`, `src="assets/img/a.png"`,
		},
		"profil/index.html": {
			`href="../assets/css/styles.css"`, `href="../profil/index.html"`, `src="../assets/img/a.png"`,
		},
		"produk/sepatu/index.html": {
			`href="../../assets/css/styles.css"`, `href="../../profil/index.html"`, `src="../../assets/img/a.png"`,
		},
	}
	for docPath, wants := range cases {
		got := relativize(html, docPath)
		for _, w := range wants {
			if !strings.Contains(got, w) {
				t.Errorf("%s: tidak ada %s\n  got: %s", docPath, w, got)
			}
		}
	}
}

// URL eksternal dan protocol-relative tidak boleh ikut dipotong — kalau kena,
// gambar/script pihak ketiga jadi 404.
func TestRelativize_LeavesNonRootPaths(t *testing.T) {
	const html = `<img src="https://cdn.example.com/a.png"><script src="//cdn.example.com/b.js"></script>` +
		`<a href="https://example.com">x</a><a href="#bagian">y</a>`

	got := relativize(html, "produk/sepatu/index.html")
	if got != html {
		t.Errorf("berubah padahal tidak boleh:\n  got:  %s\n  want: %s", got, html)
	}
}

// `/` telanjang tidak punya padanan relatif yang valid: tanpa normalisasi ia
// jadi href="" yang menunjuk balik ke halaman itu sendiri.
func TestRelativize_BareRootBecomesHomeDocument(t *testing.T) {
	for docPath, want := range map[string]string{
		"index.html":        `href="index.html"`,
		"profil/index.html": `href="../index.html"`,
	} {
		if got := relativize(`<a href="/">Beranda</a>`, docPath); !strings.Contains(got, want) {
			t.Errorf("%s: mau %s, dapat %s", docPath, want, got)
		}
	}
}

// Menu yang bersarang di dalam Container/Columns dulu dilewati rewriteLinks
// karena loop-nya cuma menyentuh blok level atas — link-nya tetap menunjuk
// path in-app dan 404 begitu ZIP di-host.
func TestRewriteLinks_DescendsIntoChildren(t *testing.T) {
	nav := Block{Type: "Navbar", Props: map[string]any{
		"links": []any{
			map[string]any{"href": "/profil", "label": "Profil"},
			map[string]any{"href": "/", "label": "Beranda"},
		},
	}}
	tree := Tree{Blocks: []Block{{
		Type:     "Container",
		Children: []Block{{Type: "Columns", Children: []Block{nav}}},
	}}}

	rewriteLinks(&tree, []pages.Page{
		{Slug: "home", IsHome: true},
		{Slug: "profil"},
	})

	links := tree.Blocks[0].Children[0].Children[0].Props["links"].([]any)
	if h := links[0].(map[string]any)["href"]; h != "/profil/index.html" {
		t.Errorf("link bersarang tidak di-rewrite: %v", h)
	}
	if h := links[1].(map[string]any)["href"]; h != "/index.html" {
		t.Errorf("link home tidak di-rewrite: %v", h)
	}
}

// Rewrite layout dijalankan sekali lalu tree halaman di-rewrite lagi; kalau
// tidak idempotent, path akan tertumpuk jadi /profil/index.html/index.html.
func TestRewriteLinks_Idempotent(t *testing.T) {
	tree := Tree{Blocks: []Block{{Type: "Navbar", Props: map[string]any{
		"links": []any{map[string]any{"href": "/profil"}},
	}}}}
	all := []pages.Page{{Slug: "profil"}}

	rewriteLinks(&tree, all)
	rewriteLinks(&tree, all)

	links := tree.Blocks[0].Props["links"].([]any)
	if h := links[0].(map[string]any)["href"]; h != "/profil/index.html" {
		t.Errorf("rewrite kedua merusak href: %v", h)
	}
}

// Versi lama minta 100 item sekali jalan tanpa paging, jadi item ke-101 dst
// hilang dari export tanpa peringatan.
func TestListAll_FetchesEveryPage(t *testing.T) {
	const total = 450
	calls := 0
	got, err := listAll(func(limit, offset int) ([]int, int, error) {
		calls++
		var out []int
		for i := offset; i < offset+limit && i < total; i++ {
			out = append(out, i)
		}
		return out, total, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != total {
		t.Errorf("dapat %d item dari %d (%d panggilan)", len(got), total, calls)
	}
}

// Error query dulu dibuang (`prods, _, _ =`) sehingga ZIP dilaporkan sukses
// padahal isinya kurang.
func TestListAll_PropagatesError(t *testing.T) {
	sentinel := errors.New("db down")
	_, err := listAll(func(limit, offset int) ([]int, int, error) {
		return nil, 0, sentinel
	})
	if !errors.Is(err, sentinel) {
		t.Errorf("error ditelan: %v", err)
	}
}

// Blok yang tidak punya case di renderBlock jatuh ke placeholder komentar dan
// hilang dari hasil export tanpa error apa pun. Test ini mengunci invariant: setiap tipe blok yang dipakai template bawaan harus menghasilkan
// markup nyata.
func TestRenderBlock_CoversEveryBuiltinTemplateBlock(t *testing.T) {
	seen := map[string]bool{}
	var walk func(blocks []any)
	walk = func(blocks []any) {
		for _, raw := range blocks {
			m, ok := raw.(map[string]any)
			if !ok {
				continue
			}
			if typ, _ := m["type"].(string); typ != "" {
				seen[typ] = true
			}
			if kids, ok := m["children"].([]map[string]any); ok {
				as := make([]any, len(kids))
				for i, k := range kids {
					as[i] = k
				}
				walk(as)
			}
		}
	}
	for _, tpl := range templates.BuiltinTemplates() {
		for _, p := range tpl.Pages {
			tree, _ := p["tree"].(map[string]any)
			blocks, _ := tree["blocks"].([]map[string]any)
			as := make([]any, len(blocks))
			for i, b := range blocks {
				as[i] = b
			}
			walk(as)
		}
	}
	if len(seen) == 0 {
		t.Fatal("tidak ada tipe blok terkumpul — struktur template berubah?")
	}
	for typ := range seen {
		var b strings.Builder
		renderBlock(&b, Block{Type: typ, Props: map[string]any{}}, nil)
		if strings.Contains(b.String(), "<!-- block:"+typ) {
			t.Errorf("blok %q tidak punya renderer di exporter — hasil export akan kosong", typ)
		}
	}
}

// Situs lama masih bisa menyimpan blok Guru* yang sudah dipensiunkan; export
// harus tetap jalan dan blok itu tidak boleh menghasilkan markup terlihat.
func TestRenderBlock_RetiredBlockRendersNothingVisible(t *testing.T) {
	var b strings.Builder
	renderBlock(&b, Block{Type: "GuruBannerCarousel", Props: map[string]any{"title": "x"}}, nil)
	if got := b.String(); got != "<!-- block:GuruBannerCarousel -->" {
		t.Errorf("mau hanya marker komentar, dapat %q", got)
	}
}

func TestCollectImageSrcs_SkipsIframeAndData(t *testing.T) {
	docs := []exportDoc{{html: `<img src="https://cdn.test/a.png"><iframe src="https://maps.test/x"></iframe>` +
		`<img src="data:image/png;base64,AAA"><img src="https://cdn.test/a.png"><a href="https://cdn.test/b.png">b</a>`}}
	got := collectImageSrcs(docs)
	if len(got) != 1 || got[0] != "https://cdn.test/a.png" {
		t.Fatalf("got %v, mau cuma src <img> yang unik", got)
	}
}

func TestResolveAssetURL(t *testing.T) {
	cases := []struct {
		src, want string
		ok        bool
	}{
		{"https://cdn.test/a.png", "https://cdn.test/a.png", true},
		{"http://cdn.test/a.png", "http://cdn.test/a.png", true},
		{"/templates/x/a.png", "", false},
		{"relatif.png", "", false},
	}
	for _, c := range cases {
		got, ok := resolveAssetURL(c.src)
		if got != c.want || ok != c.ok {
			t.Errorf("resolveAssetURL(%q) = %q,%v mau %q,%v", c.src, got, ok, c.want, c.ok)
		}
	}
}

// Rewrite hanya boleh menyentuh <img src>. URL yang sama di <a href> atau
// <iframe src> harus tetap menunjuk sumber aslinya.
func TestRewriteImageSrcs_OnlyTouchesImgTags(t *testing.T) {
	const in = `<img src="https://cdn.test/a.png" alt="x"><a href="https://cdn.test/a.png">l</a><iframe src="https://cdn.test/a.png"></iframe>`
	got := rewriteImageSrcs(in, map[string]string{"https://cdn.test/a.png": "/assets/img/deadbeef.png"})
	if !strings.Contains(got, `<img src="/assets/img/deadbeef.png" alt="x">`) {
		t.Errorf("img src tidak di-rewrite: %s", got)
	}
	if strings.Count(got, "https://cdn.test/a.png") != 2 {
		t.Errorf("href/iframe ikut berubah: %s", got)
	}
}

// Endpoint export mengunduh URL yang berasal dari konten user, jadi guard ini
// yang mencegahnya dipakai sebagai SSRF ke metadata cloud / service internal.
func TestIsPublicIP_BlocksInternalRanges(t *testing.T) {
	blocked := []string{"127.0.0.1", "10.1.2.3", "192.168.1.1", "172.16.0.1",
		"169.254.169.254", "0.0.0.0", "100.64.0.1", "::1", "fc00::1"}
	for _, s := range blocked {
		if isPublicIP(net.ParseIP(s)) {
			t.Errorf("%s seharusnya diblokir", s)
		}
	}
	for _, s := range []string{"8.8.8.8", "1.1.1.1", "2606:4700::1111"} {
		if !isPublicIP(net.ParseIP(s)) {
			t.Errorf("%s seharusnya diizinkan", s)
		}
	}
}

func TestAssetZipPath_StableAndTyped(t *testing.T) {
	a := assetZipPath("https://cdn.test/foto.jpg", "image/jpeg")
	if a != assetZipPath("https://cdn.test/foto.jpg", "image/jpeg") {
		t.Error("nama file harus stabil untuk URL yang sama")
	}
	if !strings.HasPrefix(a, "assets/img/") || !strings.HasSuffix(a, ".jpg") {
		t.Errorf("path tak terduga: %s", a)
	}
	// Nama file yang sama dari host berbeda tidak boleh saling menimpa.
	if a == assetZipPath("https://lain.test/foto.jpg", "image/jpeg") {
		t.Error("URL berbeda menghasilkan nama file sama")
	}
}

func TestDownloadImages_RejectsNonImageAndOversize(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/ok.png":
			w.Header().Set("Content-Type", "image/png")
			w.Write([]byte("PNGDATA"))
		case "/besar.png":
			w.Header().Set("Content-Type", "image/png")
			w.Write(make([]byte, maxImageBytes+10))
		default:
			w.Header().Set("Content-Type", "text/html")
			w.Write([]byte("<html>"))
		}
	}))
	defer srv.Close()

	var buf bytes.Buffer
	z := zip.NewWriter(&buf)
	got, failed := downloadImages(context.Background(), z,
		[]string{srv.URL + "/ok.png", srv.URL + "/besar.png", srv.URL + "/halaman.html"},
		srv.Client())
	z.Close()

	if len(got) != 1 {
		t.Fatalf("mau cuma 1 gambar terunduh, dapat %v", got)
	}
	if _, ok := got[srv.URL+"/ok.png"]; !ok {
		t.Error("gambar valid tidak terunduh")
	}
	// Yang gagal harus dilaporkan, bukan hilang diam-diam.
	if len(failed) != 2 {
		t.Errorf("mau 2 gambar dilaporkan gagal, dapat %v", failed)
	}
}

// Guard harus menolak saat dial, bukan hanya saat parsing URL — httptest selalu
// bind ke loopback, jadi server ini mewakili "service internal" yang tidak
// boleh terjangkau dari konten user.
func TestNewAssetClient_BlocksLoopbackUnlessAllowlisted(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		w.Write([]byte("RAHASIA"))
	}))
	defer srv.Close()

	var buf bytes.Buffer
	z := zip.NewWriter(&buf)
	got, _ := downloadImages(context.Background(), z, []string{srv.URL + "/a.png"}, newAssetClient(nil))
	z.Close()
	if len(got) != 0 {
		t.Fatalf("loopback seharusnya diblokir, tapi terunduh: %v", got)
	}

	// Host storage yang dikonfigurasi operator tetap boleh walau alamatnya
	// internal — MinIO dan /uploads lokal memang beralamat privat.
	z2 := zip.NewWriter(&bytes.Buffer{})
	got2, _ := downloadImages(context.Background(), z2, []string{srv.URL + "/a.png"},
		newAssetClient(allowedInternalHosts(srv.URL)))
	z2.Close()
	if len(got2) != 1 {
		t.Errorf("host yang di-allowlist seharusnya bisa diunduh, dapat %v", got2)
	}
}

// Sebelum ini, blok tak dikenal dan gambar gagal hanya menghasilkan placeholder
// komentar — user menerima ZIP yang dilaporkan sukses padahal isinya kurang.
func TestCollectUnknownBlocks_DeduplicatesAndSorts(t *testing.T) {
	docs := []exportDoc{
		{path: "index.html", html: `<div><!-- block:Zeta --></div><!-- block:Alpha -->`},
		{path: "profil/index.html", html: `<!-- block:Alpha --><!-- block:Mystery -->`},
	}
	got := collectUnknownBlocks(docs)
	want := []string{"Alpha", "Mystery", "Zeta"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Errorf("mau %v, dapat %v", want, got)
	}
}

func TestBuildWarningFile_ListsBothKinds(t *testing.T) {
	out := buildWarningFile(&exportReport{
		unknownBlocks: []string{"Mystery"},
		failedImages:  []string{"https://contoh.test/a.png"},
	})
	for _, want := range []string{"Mystery", "https://contoh.test/a.png", "PERINGATAN"} {
		if !strings.Contains(out, want) {
			t.Errorf("laporan tidak memuat %q:\n%s", want, out)
		}
	}
}

// Daftar panjang harus dipotong supaya laporan tetap terbaca.
func TestBuildWarningFile_TruncatesLongImageList(t *testing.T) {
	var imgs []string
	for i := 0; i < maxReportedImages+5; i++ {
		imgs = append(imgs, "https://contoh.test/"+strconv.Itoa(i)+".png")
	}
	out := buildWarningFile(&exportReport{failedImages: imgs})
	if !strings.Contains(out, "dan 5 gambar lainnya") {
		t.Errorf("daftar tidak dipotong:\n%s", out)
	}
}

func TestExportReport_EmptyWhenNothingFailed(t *testing.T) {
	if !(&exportReport{}).empty() {
		t.Error("laporan kosong seharusnya empty()")
	}
	if (&exportReport{unknownBlocks: []string{"X"}}).empty() {
		t.Error("laporan berisi blok tak dikenal seharusnya tidak empty()")
	}
}
