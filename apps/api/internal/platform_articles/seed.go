package platform_articles

import (
	"context"
	"encoding/json"
	"log/slog"
)

// SeedIfEmpty — idempotent seeder. Cek total articles di DB; kalau 0, insert
// 6 sample articles yang menarik untuk demo homepage. Dipanggil dari main.go
// setelah migrate + repo build.
func SeedIfEmpty(ctx context.Context, r *Repo) error {
	n, err := r.CountPublic(ctx)
	if err != nil {
		return err
	}
	if n > 0 {
		slog.Info("platform_articles: seed skipped (already populated)", "count", n)
		return nil
	}
	slog.Info("platform_articles: seeding 6 sample articles")
	for _, a := range samples() {
		if _, err := r.Create(ctx, a); err != nil {
			slog.Warn("platform_articles: seed row failed",
				"slug", a.Slug, "error", err)
		}
	}
	return nil
}

func tags(vs ...string) json.RawMessage {
	b, _ := json.Marshal(vs)
	return b
}

func samples() []CreateInput {
	return []CreateInput{
		// ---- Featured: hero ----
		{
			Slug:           "kenapa-umkm-perlu-website-sendiri",
			Title:          "Kenapa UMKM Perlu Website Sendiri?",
			Excerpt:        "Marketplace dan media sosial memang ramai, tapi aturannya milik orang lain. Website sendiri adalah etalase yang tidak bisa diambil siapa pun dari usaha Anda.",
			CoverImageURL:  "",
			Category:       "cerita",
			AuthorName:     "Tim Web Builder",
			Tags:           tags("umkm", "website", "branding", "jualan-online"),
			Status:         "published",
			Featured:       true,
			ReadingTimeMin: 6,
			SEOTitle:       "Kenapa UMKM Perlu Website Sendiri — Bukan Cuma Akun Marketplace",
			SEODescription: "Manfaat website sendiri untuk UMKM: kepercayaan pembeli, kendali penuh atas etalase, dan tidak bergantung pada algoritma atau potongan marketplace.",
			BodyMD: `## Etalase yang benar-benar milik Anda

Banyak usaha kecil memulai dari lapak marketplace atau akun media sosial. Itu
langkah yang bagus — pembeli memang ada di sana. Masalahnya muncul belakangan:
biaya admin naik, algoritma berubah, atau akun tiba-tiba dibatasi. Semua yang
sudah dibangun bertahun-tahun bisa hilang dalam semalam.

Website sendiri memberi Anda **alamat tetap** di internet. Pembeli yang sudah
kenal bisa kembali kapan saja, tanpa harus mencari nama toko Anda di antara
ribuan penjual lain.

## Tiga alasan praktis

### 1. Pembeli lebih percaya

Calon pembeli yang menemukan ` + "`namausaha.id`" + ` langsung menangkap bahwa
usaha ini serius. Alamat web sendiri, foto produk rapi, dan informasi kontak
yang jelas adalah sinyal kepercayaan — apalagi untuk pembeli pertama kali.

### 2. Anda yang mengatur tampilan

Di marketplace, semua toko terlihat sama. Di website sendiri, Anda menentukan
warna, cerita usaha, urutan produk, dan promo mana yang ditampilkan paling
depan. Merek Anda tampil utuh, bukan sekadar nama di daftar pencarian.

### 3. Tidak bergantung pada satu platform

Website tidak menggantikan marketplace — keduanya saling melengkapi. Tautkan
website di bio Instagram, kartu nama, dan kemasan produk. Kalau suatu saat
satu kanal bermasalah, pelanggan tetap tahu ke mana harus mencari Anda.

## Mulai dari yang sederhana

Website UMKM tidak harus rumit. Halaman beranda, katalog produk, cerita
singkat tentang usaha, dan tombol pesan lewat WhatsApp sudah cukup untuk
mulai menerima pesanan. Sisanya bisa ditambah sambil jalan.

Yang terpenting: **mulai sekarang**, selagi nama domain usaha Anda masih
tersedia.`,
		},

		// ---- Tutorial ----
		{
			Slug:           "cara-membuat-toko-online-dalam-15-menit",
			Title:          "Cara Membuat Toko Online dalam 15 Menit",
			Excerpt:        "Panduan langkah demi langkah dari nol sampai toko online Anda tayang: beli domain, pilih template UMKM, isi produk, lalu publikasikan.",
			CoverImageURL:  "",
			Category:       "tutorial",
			AuthorName:     "Tim Web Builder",
			Tags:           tags("tutorial", "toko-online", "panduan-cepat"),
			Status:         "published",
			Featured:       true,
			ReadingTimeMin: 8,
			SEOTitle:       "Tutorial: Membuat Toko Online UMKM dalam 15 Menit",
			SEODescription: "Langkah praktis membuat toko online untuk UMKM: beli domain .id, pilih template, tambah produk, dan publikasikan. Cocok untuk pemula.",
			BodyMD: `## Yang perlu disiapkan

Sebelum mulai, siapkan tiga hal ini supaya prosesnya lancar:

- **Nama usaha** dan ide nama domain (2–3 alternatif)
- **Foto produk** — minimal 3–5 produk andalan
- **Nomor WhatsApp** yang aktif untuk menerima pesanan

## Langkah 1: Cari dan beli domain

Dari dashboard, klik **Beli Domain + Buat Situs**. Ketik nama usaha Anda,
lalu cek ketersediaannya. Beberapa contoh pola yang mudah diingat:

- ` + "`keripikbudesi.id`" + ` — nama produk + pemilik
- ` + "`kopilerengmerapi.id`" + ` — produk + asal daerah
- ` + "`batikjelita.my.id`" + ` — merek pendek

Lengkapi data pemilik, pilih metode pembayaran, dan selesaikan pembayaran.

## Langkah 2: Pilih template UMKM

Setelah domain aktif, pilihan template akan muncul. Pilih salah satu varian
kategori **UMKM / Jualan**. Template ini sudah berisi beranda, katalog produk,
halaman tentang, dan kontak — tinggal diganti dengan konten Anda.

## Langkah 3: Tambahkan produk

Buka menu **Produk** di dashboard situs. Untuk setiap produk, isi:

- Nama produk dan harga
- Foto (pakai foto terbaik, rasio persegi paling aman)
- Deskripsi singkat: bahan, ukuran, varian rasa atau warna

Produk yang berstatus aktif otomatis tampil di blok katalog.

## Langkah 4: Sesuaikan tampilan

Masuk ke **Editor**. Ganti judul beranda, cerita singkat usaha, dan nomor
WhatsApp di tombol pesan. Atur warna utama agar sesuai logo atau kemasan
produk Anda.

## Langkah 5: Publikasikan

Klik **Publish**. Dalam hitungan menit toko online Anda sudah bisa dibuka di
domain sendiri. Bagikan tautannya ke grup pelanggan, bio Instagram, dan
status WhatsApp.

## Setelah tayang

- Tambah produk baru setiap ada stok atau varian baru
- Tulis artikel singkat di blog — misalnya cara penyajian atau cerita bahan
- Pantau statistik pengunjung untuk tahu produk mana yang paling diminati`,
		},

		// ---- Tips ----
		{
			Slug:           "tips-foto-produk-dengan-hp",
			Title:          "Tips Foto Produk yang Menarik Cukup dengan HP",
			Excerpt:        "Tidak perlu kamera mahal. Dengan cahaya jendela, latar polos, dan sedikit trik komposisi, foto produk dari HP bisa terlihat profesional.",
			CoverImageURL:  "",
			Category:       "tips",
			AuthorName:     "Tim Web Builder",
			Tags:           tags("foto-produk", "tips", "konten"),
			Status:         "published",
			Featured:       false,
			ReadingTimeMin: 5,
			SEOTitle:       "Tips Foto Produk UMKM dengan HP — Hasil Rapi Tanpa Studio",
			SEODescription: "Panduan foto produk dengan HP untuk UMKM: memanfaatkan cahaya alami, memilih latar, mengatur komposisi, dan mengedit secukupnya.",
			BodyMD: `Foto adalah hal pertama yang dilihat pembeli. Kabar baiknya, HP yang Anda
pakai sehari-hari sudah lebih dari cukup. Kuncinya ada di persiapan, bukan
di alat.

## 1. Manfaatkan cahaya jendela

Cahaya alami dari jendela di pagi atau sore hari adalah lampu studio
gratis. Letakkan produk di dekat jendela, hindari sinar matahari langsung
yang membuat bayangan keras. Kalau terlalu terang, tempel kertas HVS atau
kain tipis di kaca sebagai peredam.

**Matikan lampu ruangan** supaya warna produk tidak tercampur cahaya kuning.

## 2. Pakai latar yang polos

Kertas karton putih, kain linen, atau papan kayu sudah cukup. Latar polos
membuat produk menjadi pusat perhatian. Untuk produk makanan, latar kayu
atau kain bertekstur memberi kesan hangat dan alami.

## 3. Atur sudut sesuai produk

- **Dari atas (flat lay)** — cocok untuk makanan dalam piring, aksesori,
  atau produk yang ditata berjajar
- **Sejajar mata (45°)** — cocok untuk minuman dalam botol, kemasan berdiri,
  dan produk yang punya sisi depan
- **Detail dekat** — tunjukkan tekstur: renyahnya keripik, serat kain, atau
  jahitan tas

## 4. Bersihkan lensa dan kunci fokus

Lap lensa HP sebelum memotret — sidik jari membuat foto tampak buram. Ketuk
layar di bagian produk untuk mengunci fokus dan atur kecerahan dengan
menggeser ikon matahari.

## 5. Edit secukupnya

Naikkan sedikit kecerahan dan kontras, rapikan potongan, lalu berhenti.
Hindari filter berlebihan: pembeli ingin melihat warna asli produk. Foto
yang jujur mengurangi komplain setelah barang diterima.

## Bonus: konsisten

Pakai latar, sudut, dan pencahayaan yang sama untuk semua produk. Katalog
yang seragam terlihat jauh lebih profesional daripada foto bagus yang
gayanya berbeda-beda.`,
		},

		// ---- Panduan ----
		{
			Slug:           "memilih-domain-id-untuk-usaha",
			Title:          "Memilih Domain .id untuk Usaha Anda",
			Excerpt:        ".id, .co.id, .my.id, .biz.id — apa bedanya dan mana yang paling pas untuk usaha Anda? Panduan singkat memilih ekstensi dan nama domain.",
			CoverImageURL:  "",
			Category:       "panduan",
			AuthorName:     "Tim PANDI",
			Tags:           tags("domain", "id", "panduan", "branding"),
			Status:         "published",
			Featured:       true,
			ReadingTimeMin: 7,
			SEOTitle:       "Panduan Memilih Domain .id untuk UMKM dan Usaha",
			SEODescription: "Perbedaan .id, .co.id, .my.id, .biz.id, dan .web.id, plus tips memilih nama domain yang mudah diingat untuk usaha Anda.",
			BodyMD: `## Kenapa domain .id?

Domain berakhiran **.id** adalah identitas internet Indonesia. Pembeli di
dalam negeri langsung mengenali bahwa usaha Anda berasal dari Indonesia,
dan namanya masih relatif lebih banyak tersedia dibanding .com.

## Mengenal ekstensinya

| Ekstensi   | Cocok untuk                                  | Persyaratan                    |
|------------|----------------------------------------------|--------------------------------|
| ` + "`.id`" + `      | Merek usaha, toko online, semua kalangan      | KTP                            |
| ` + "`.biz.id`" + `  | Usaha dan bisnis kecil                        | KTP                            |
| ` + "`.my.id`" + `   | Usaha rumahan atau personal branding          | KTP                            |
| ` + "`.web.id`" + `  | Komunitas atau usaha yang baru dirintis       | KTP                            |
| ` + "`.co.id`" + `   | Badan usaha resmi (PT, CV, koperasi)          | KTP + dokumen legalitas usaha  |

Kalau usaha Anda belum berbadan hukum, **.id** atau **.biz.id** adalah
pilihan yang aman dan mudah. Ketika usaha sudah resmi menjadi CV atau PT,
Anda bisa menambah **.co.id** untuk memperkuat kepercayaan.

## Tips memilih nama

1. **Pendek dan mudah diucapkan.** Bayangkan menyebutkannya lewat telepon —
   kalau perlu dieja berkali-kali, cari alternatif.
2. **Hindari angka dan tanda hubung** kecuali memang bagian dari merek.
3. **Sesuaikan dengan merek**, bukan produk saat ini. ` + "`dapurbunda.id`" + `
   lebih awet daripada ` + "`jualnastarmurah.id`" + ` kalau suatu hari Anda menambah
   produk lain.
4. **Cek media sosial.** Usahakan nama domain sama dengan akun Instagram
   atau TikTok usaha supaya pelanggan tidak bingung.

## Jangan lupa perpanjang

Domain berlaku per tahun. Aktifkan pengingat dan perpanjang sebelum masa
aktif habis — domain yang terlepas bisa didaftarkan orang lain, dan semua
tautan yang sudah tersebar di kemasan atau kartu nama ikut mati.

Siap memulai? Ikuti [Cara Membuat Toko Online dalam 15 Menit](/artikel/cara-membuat-toko-online-dalam-15-menit).`,
		},

		// ---- Tips: WhatsApp ----
		{
			Slug:           "menerima-pesanan-lewat-whatsapp-dari-website",
			Title:          "Menerima Pesanan lewat WhatsApp dari Website",
			Excerpt:        "Belum perlu sistem keranjang yang rumit. Tombol WhatsApp yang ditata dengan baik sudah bisa mengubah pengunjung website menjadi pembeli.",
			CoverImageURL:  "",
			Category:       "tips",
			AuthorName:     "Tim Web Builder",
			Tags:           tags("whatsapp", "pesanan", "jualan-online"),
			Status:         "published",
			Featured:       false,
			ReadingTimeMin: 5,
			SEOTitle:       "Cara Menerima Pesanan WhatsApp dari Website Toko Online",
			SEODescription: "Cara memasang tombol pesan WhatsApp di website UMKM, membuat pesan otomatis, dan tips merespons pembeli agar pesanan cepat jadi.",
			BodyMD: `Sebagian besar pembeli UMKM di Indonesia lebih nyaman bertanya dulu
sebelum membayar. WhatsApp adalah tempat percakapan itu terjadi. Website
Anda cukup menjadi etalase yang mengantar mereka ke sana.

## 1. Pakai tautan wa.me

Format tautannya sederhana:

` + "```" + `
https://wa.me/6281234567890
` + "```" + `

Ganti angka 0 di depan nomor dengan **62**, tanpa spasi atau tanda hubung.
Pasang tautan ini di tombol utama beranda, di setiap halaman produk, dan di
bagian kontak.

## 2. Siapkan pesan pembuka otomatis

Tambahkan parameter ` + "`text`" + ` supaya pembeli tidak bingung mau menulis apa:

` + "```" + `
https://wa.me/6281234567890?text=Halo,%20saya%20mau%20pesan%20Keripik%20Pedas%20200gr
` + "```" + `

Tulis pesan yang menyebutkan nama produk. Anda langsung tahu produk mana
yang ditanyakan tanpa harus bertanya balik.

## 3. Letakkan tombol di tempat yang tepat

- **Beranda** — tombol besar "Pesan via WhatsApp" di bagian paling atas
- **Katalog** — tombol kecil di setiap kartu produk
- **Bagian bawah halaman** — untuk pengunjung yang membaca sampai habis

## 4. Gunakan WhatsApp Business

Aplikasi WhatsApp Business gratis dan punya fitur yang sangat membantu:
pesan sapaan otomatis, balasan cepat untuk pertanyaan yang sering muncul,
label untuk menandai status pesanan, dan katalog produk.

## 5. Balas dengan cepat dan jelas

Pembeli yang menunggu terlalu lama biasanya pindah ke penjual lain.
Cantumkan jam operasional di website, dan siapkan template balasan berisi
harga, ongkos kirim, dan cara pembayaran supaya transaksi cepat selesai.

Dengan alur sederhana ini, website bekerja 24 jam mengenalkan produk Anda,
sementara percakapan dan penutupan transaksi tetap terasa personal.`,
		},

		// ---- Cerita ----
		{
			Slug:           "cerita-umkm-dari-lapak-ke-toko-online",
			Title:          "Cerita UMKM: dari Lapak Pasar ke Toko Online",
			Excerpt:        "Bu Ratna sepuluh tahun berjualan sambal di lapak pasar. Pandemi memaksanya mencoba jualan online — dan ternyata justru membuka pasar yang tidak pernah ia bayangkan.",
			CoverImageURL:  "",
			Category:       "cerita",
			AuthorName:     "Tim Editorial",
			Tags:           tags("cerita", "umkm", "inspirasi", "kuliner"),
			Status:         "published",
			Featured:       false,
			ReadingTimeMin: 6,
			SEOTitle:       "Cerita UMKM: Perjalanan dari Lapak Pasar ke Toko Online",
			SEODescription: "Kisah pelaku UMKM sambal rumahan yang beralih dari lapak pasar ke toko online dengan website sendiri dan pesanan lewat WhatsApp.",
			BodyMD: `## Sepuluh tahun di lapak yang sama

Setiap pagi pukul lima, Bu Ratna sudah menata toples-toples sambal di
lapaknya di pasar. Sambal bawang, sambal cumi, sambal teri — semua diulek
sendiri di dapur rumahnya. Pelanggannya setia, tapi jumlahnya hampir tidak
bertambah dari tahun ke tahun.

"Yang beli ya itu-itu saja. Orang pasar sini," kenangnya.

## Ketika pasar sepi

Saat pengunjung pasar menurun drastis, pemasukan ikut anjlok. Anak
sulungnya menyarankan mencoba jualan lewat status WhatsApp. Beberapa
pesanan masuk dari kerabat, lalu dari teman kerabat. Masalahnya, setiap
calon pembeli menanyakan hal yang sama berulang kali: ada varian apa saja,
berapa harganya, bisa dikirim ke luar kota atau tidak.

## Satu alamat untuk semua pertanyaan

Mereka lalu membuat website sederhana dengan domain nama usahanya sendiri.
Isinya tidak banyak: foto setiap varian sambal, harga, daya tahan produk,
cara pengiriman, dan tombol pesan lewat WhatsApp.

Perubahannya terasa dalam beberapa minggu:

- **Pertanyaan berulang berkurang** — pembeli sudah membaca informasinya
  sebelum menghubungi
- **Pesanan datang dari luar kota** — tautan website dibagikan dari satu
  grup keluarga ke grup lainnya
- **Pembeli lebih yakin** — melihat foto dapur dan cerita usaha membuat
  mereka percaya sambalnya dibuat dengan bersih

## Lapak tetap buka

Bu Ratna tidak meninggalkan pasar. Lapaknya kini justru menjadi tempat
pelanggan lama mengambil pesanan, sementara website melayani pembeli dari
kota lain. Di setiap toples kini tertempel stiker kecil berisi alamat
websitenya.

"Dulu saya kira jualan online itu harus ngerti teknologi," katanya sambil
tertawa. "Ternyata yang penting sambalnya enak, fotonya jelas, dan cepat
balas chat."

---

*Nama dan detail usaha disamarkan atas permintaan narasumber.*`,
		},
	}
}
