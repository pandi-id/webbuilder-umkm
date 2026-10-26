package exports

import (
	"archive/zip"
	"context"
	"crypto/sha1"
	"encoding/hex"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"syscall"
)

// Tanpa ini hasil export tidak self-contained: setiap <img> tetap menunjuk
// MinIO/domain user, jadi begitu situs asli mati atau domain lepas, seluruh
// gambar hilang. Gambar diunduh ke assets/img/ lalu src-nya ditulis ulang.
const (
	maxImageBytes = 10 << 20  // per file
	maxTotalBytes = 150 << 20 // seluruh ZIP
	maxImages     = 500
)

// Hanya <img>. <iframe> (Map, VideoEmbed) sengaja dilewati — isinya halaman
// pihak ketiga, bukan aset yang bisa dibekukan.
var imgSrcRe = regexp.MustCompile(`(?i)<img\s[^>]*?\bsrc="([^"]*)"`)

type exportDoc struct {
	path string
	html string
}

// collectImageSrcs mengembalikan src unik dalam urutan kemunculan supaya nama
// file di ZIP stabil antar-export (gampang di-diff).
func collectImageSrcs(docs []exportDoc) []string {
	seen := map[string]bool{}
	var out []string
	for _, d := range docs {
		for _, m := range imgSrcRe.FindAllStringSubmatch(d.html, -1) {
			src := m[1]
			if src == "" || seen[src] || strings.HasPrefix(src, "data:") {
				continue
			}
			seen[src] = true
			out = append(out, src)
		}
	}
	return out
}

// resolveAssetURL hanya menerima URL absolut. Gambar unggahan user selalu
// ber-URL absolut dari storage — jadi src root-relative sisanya tidak punya basis yang bisa dipercaya untuk
// diunduh, dan lebih baik dibiarkan menunjuk live daripada jadi link mati.
func resolveAssetURL(src string) (string, bool) {
	if strings.HasPrefix(src, "http://") || strings.HasPrefix(src, "https://") {
		return src, true
	}
	return "", false
}

var imageExts = map[string]string{
	"image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif",
	"image/webp": ".webp", "image/avif": ".avif", "image/svg+xml": ".svg",
	"image/x-icon": ".ico", "image/vnd.microsoft.icon": ".ico",
}

// assetZipPath menamai file dari hash URL-nya: dua situs boleh memakai nama
// file sama ("cover.jpg") tanpa saling menimpa.
func assetZipPath(srcURL, contentType string) string {
	sum := sha1.Sum([]byte(srcURL))
	name := hex.EncodeToString(sum[:])[:16]
	ext := imageExts[strings.TrimSpace(strings.Split(contentType, ";")[0])]
	if ext == "" {
		ext = path.Ext(strings.SplitN(path.Base(srcURL), "?", 2)[0])
	}
	if ext == "" {
		ext = ".img"
	}
	return "assets/img/" + name + ext
}

var errBlockedAddr = errors.New("alamat internal diblokir")

// newAssetClient menolak koneksi ke alamat privat/loopback. Exporter mengunduh
// URL yang berasal dari konten user, jadi tanpa guard ini endpoint export jadi
// SSRF: cukup menaruh <img src="http://169.254.169.254/..."> di sebuah blok
// untuk membuat server membocorkan metadata cloud ke dalam ZIP.
//
// allowHosts memuat base internal (misal "renderer:3000" di Docker) yang
// memang sah walau IP-nya privat.
func newAssetClient(allowHosts map[string]bool) *http.Client {
	dialer := &net.Dialer{}
	dialer.Control = func(network, address string, _ syscall.RawConn) error {
		host, _, err := net.SplitHostPort(address)
		if err != nil {
			return err
		}
		ip := net.ParseIP(host)
		if ip == nil {
			return errBlockedAddr
		}
		if isPublicIP(ip) {
			return nil
		}
		return errBlockedAddr
	}
	return &http.Client{
		Transport: &http.Transport{
			DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
				if allowHosts[addr] {
					return (&net.Dialer{}).DialContext(ctx, network, addr)
				}
				return dialer.DialContext(ctx, network, addr)
			},
			DisableKeepAlives: true,
		},
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 3 {
				return errors.New("terlalu banyak redirect")
			}
			return nil
		},
	}
}

func isPublicIP(ip net.IP) bool {
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() || ip.IsUnspecified() || ip.IsMulticast() {
		return false
	}
	// 100.64.0.0/10 (CGNAT) tidak dicakup IsPrivate tapi tetap jaringan internal.
	if v4 := ip.To4(); v4 != nil && v4[0] == 100 && v4[1] >= 64 && v4[1] <= 127 {
		return false
	}
	return true
}

// downloadImages menulis setiap gambar ke ZIP dan mengembalikan peta
// src-asli → path di ZIP plus daftar src yang gagal. Kegagalan satu gambar
// tidak membatalkan export: src-nya dibiarkan menunjuk URL live, bukan jadi
// link mati — tapi user tetap harus diberi tahu lewat laporan.
func downloadImages(ctx context.Context, z *zip.Writer, srcs []string, client *http.Client) (map[string]string, []string) {
	out := map[string]string{}
	var failed []string
	var total int64
	for i, src := range srcs {
		if len(out) >= maxImages || total >= maxTotalBytes {
			failed = append(failed, srcs[i:]...)
			break
		}
		abs, body, ctype, err := loadImage(ctx, client, src)
		if err != nil {
			failed = append(failed, src)
			continue
		}
		zp := assetZipPath(abs, ctype)
		if err := writeFile(z, zp, string(body)); err != nil {
			failed = append(failed, src)
			continue
		}
		total += int64(len(body))
		out[src] = "/" + zp
	}
	return out, failed
}

// loadImage mengunduh satu gambar. Mengembalikan juga URL kanonik supaya
// penamaan file di ZIP tetap content-addressed.
func loadImage(ctx context.Context, client *http.Client, src string) (string, []byte, string, error) {
	abs, ok := resolveAssetURL(src)
	if !ok {
		return "", nil, "", errors.New("src tidak bisa diresolusi: " + src)
	}
	body, ctype, err := fetchImage(ctx, client, abs)
	if err != nil {
		return "", nil, "", err
	}
	return abs, body, ctype, nil
}

func fetchImage(ctx context.Context, client *http.Client, rawURL string) ([]byte, string, error) {
	u, err := url.Parse(rawURL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return nil, "", errors.New("skema URL tidak didukung")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, "", err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, "", errors.New("status " + resp.Status)
	}
	ctype := resp.Header.Get("Content-Type")
	if !strings.HasPrefix(strings.ToLower(ctype), "image/") {
		return nil, "", errors.New("bukan gambar: " + ctype)
	}
	// LimitReader +1 byte supaya file yang melebihi batas terdeteksi, bukan
	// diam-diam ditulis dalam keadaan terpotong.
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxImageBytes+1))
	if err != nil {
		return nil, "", err
	}
	if len(body) > maxImageBytes {
		return nil, "", errors.New("gambar terlalu besar")
	}
	return body, ctype, nil
}

// rewriteImageSrcs hanya menyentuh atribut src di dalam tag <img> supaya URL
// yang sama di <a href> atau <iframe src> tidak ikut berubah.
func rewriteImageSrcs(html string, mapping map[string]string) string {
	if len(mapping) == 0 {
		return html
	}
	return imgSrcRe.ReplaceAllStringFunc(html, func(tag string) string {
		m := imgSrcRe.FindStringSubmatch(tag)
		if m == nil {
			return tag
		}
		local, ok := mapping[m[1]]
		if !ok {
			return tag
		}
		return strings.Replace(tag, `src="`+m[1]+`"`, `src="`+local+`"`, 1)
	})
}

// allowedInternalHosts mengizinkan base yang dikonfigurasi operator menembus
// guard IP privat — di Docker, renderer/API memang beralamat privat.
func allowedInternalHosts(bases ...string) map[string]bool {
	out := map[string]bool{}
	for _, b := range bases {
		u, err := url.Parse(b)
		if err != nil || u.Host == "" {
			continue
		}
		port := u.Port()
		if port == "" {
			port = map[string]string{"http": "80", "https": "443"}[u.Scheme]
		}
		out[net.JoinHostPort(u.Hostname(), port)] = true
	}
	return out
}

// Marker yang ditulis renderBlock untuk tipe blok tanpa renderer.
var unknownBlockRe = regexp.MustCompile(`<!-- block:([^ ]+) -->`)

const (
	warningFileName = "PERINGATAN.txt"
	// Daftar gambar gagal dipotong supaya laporan tetap terbaca kalau yang
	// bermasalah ternyata ratusan (mis. host aset mati total).
	maxReportedImages = 50
)

// exportReport mengumpulkan hal-hal yang gagal tanpa membatalkan export.
type exportReport struct {
	unknownBlocks []string
	failedImages  []string
}

func (r *exportReport) empty() bool {
	return len(r.unknownBlocks) == 0 && len(r.failedImages) == 0
}

// collectUnknownBlocks membaca marker dari HTML jadi, bukan lewat parameter
// yang harus di-thread ke seluruh renderer — pendekatan yang sama dengan
// relativize dan rewriteImageSrcs.
func collectUnknownBlocks(docs []exportDoc) []string {
	seen := map[string]bool{}
	var out []string
	for _, d := range docs {
		for _, m := range unknownBlockRe.FindAllStringSubmatch(d.html, -1) {
			if !seen[m[1]] {
				seen[m[1]] = true
				out = append(out, m[1])
			}
		}
	}
	sort.Strings(out)
	return out
}

// buildWarningFile — ZIP di-stream langsung ke response body dan header-nya
// sudah terkirim sebelum render mulai, jadi status code atau JSON warning tidak
// bisa lagi diubah. Satu-satunya kanal yang tersisa ke user adalah file di
// dalam ZIP itu sendiri.
func buildWarningFile(r *exportReport) string {
	var b strings.Builder
	b.WriteString("PERINGATAN HASIL EKSPOR\n")
	b.WriteString("=======================\n\n")
	b.WriteString("Ekspor berhasil dibuat, tetapi ada bagian yang tidak ikut terbundel.\n")
	b.WriteString("Rincian di bawah ini supaya Anda tahu persis apa yang kurang.\n\n")

	if len(r.unknownBlocks) > 0 {
		b.WriteString("1. Blok yang belum didukung exporter\n")
		b.WriteString("   Blok berikut tidak punya penerjemah ke HTML statis, jadi bagian\n")
		b.WriteString("   tersebut kosong di hasil ekspor (di situs live tetap normal):\n")
		for _, t := range r.unknownBlocks {
			b.WriteString("     - " + t + "\n")
		}
		b.WriteString("   Laporkan tipe blok di atas ke tim agar ditambahkan.\n\n")
	}
	if len(r.failedImages) > 0 {
		b.WriteString("2. Gambar yang gagal diunduh\n")
		b.WriteString("   Gambar berikut masih menunjuk alamat aslinya, bukan file di dalam\n")
		b.WriteString("   ZIP. Kalau sumbernya mati, gambar tidak akan tampil:\n")
		shown := r.failedImages
		if len(shown) > maxReportedImages {
			shown = shown[:maxReportedImages]
		}
		for _, u := range shown {
			b.WriteString("     - " + u + "\n")
		}
		if rest := len(r.failedImages) - len(shown); rest > 0 {
			b.WriteString("     ... dan " + strconv.Itoa(rest) + " gambar lainnya\n")
		}
		b.WriteString("\n")
	}
	return b.String()
}
