# TODO — Pivot ke UMKM

Branch `umkm` (dari `guru-only`). Fokus: toko online UMKM + produk. Fitur guru dihapus.

## Selesai

- [x] Branch `umkm` dari `guru-only`
- [x] Hapus template PANDI × UPI (`guru-pandi*`) + kategori `teacher` — kode, aset, dan migration `0069_drop_guru_templates.sql` untuk baris di DB
- [x] Hapus fitur guru di API, dashboard, dan renderer: Tulisan per rubrik, Forum Diskusi, Pembelajaran, Tanggapan, Ruang Promosi/banner, Profil Guru, portal `/guru`, `/panduan-guru`, Litera
- [x] Artikel dipertahankan: blog per situs (menu "Artikel") + artikel platform `/artikel` (seed diganti 6 artikel UMKM)
- [x] Situs lama yang masih berisi blok `Guru*` tidak crash: kosong di renderer/export, muncul sebagai "tidak didukung" di editor
- [x] Hapus copy & branding guru: login, sidebar, metadata, admin nav, panduan pengguna, tes Playwright guru
- [x] Landing UMKM dengan `motion` (hanya di landing, hormati reduced motion)
- [x] Dashboard situs: menu Toko / Konten / Pengaturan, ringkasan dengan statistik + checklist onboarding, kartu daftar situs baru
- [x] 9 blok UMKM Pro (Hero, Etalase Produk, Katalog dari DB, Promo + voucher, Info Toko, Marketplace, Badge Kepercayaan, Ulasan, WhatsApp melayang) di editor, renderer, dan export statis
- [x] 3 template UMKM bawaan memakai blok baru (Kopi Senja, Sekar Batik, Anyam Lestari)
- [x] Hapus snippet CSP Litera di `infra/caddy/Caddyfile` (dev)
- [x] Verifikasi: `go vet/build/test -race`, typecheck + build web dan renderer — semua lolos

## Belum / perlu keputusan

- [ ] **Commit** — semua perubahan masih di working tree
- [ ] **QA manual di browser** — belum dibuka di browser: landing di lebar 360px, editor dengan blok UMKM, alur beli domain → pilih template UMKM → tambah produk → publish
- [ ] **Migration 0069 + integration test** belum dijalankan ke Postgres (lokal tanpa `TEST_DATABASE_URL`; CI akan menjalankannya)
- [ ] **Nama brand** — landing memakai "Web Builder" (konstanta `BRAND` di `apps/web/app/page.tsx`)
- [ ] **Section harga** di landing — belum ada karena belum ada harga nyata
- [ ] **Artikel platform di DB lama** — seed hanya jalan kalau tabel kosong; DB yang sudah ada tetap menyimpan 6 artikel guru (hapus via `/admin/platform-articles` atau migration)
- [ ] **Panduan pengguna** — bab guru sudah dihapus, tapi isi `00-pengantar.md` / `10-panduan-client.md` belum ditulis ulang untuk UMKM; `web-builder-guide.html` perlu di-generate ulang (`./generate-pdf-chrome.sh`)
- [ ] **CI** — `.github/workflows/*.yml` hanya trigger di `main`; tambahkan `umkm` / `master`
- [ ] Katalog dinamis (UmkmCatalogDynamic / ProductGridDynamic) di dalam Container/Columns tidak tampil di live site — keterbatasan lama, render nested tidak menerima site ID
