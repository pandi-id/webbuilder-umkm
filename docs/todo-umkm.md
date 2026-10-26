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
- [x] Commit di branch `umkm` (belum di-push)
- [x] CI trigger di `main`, `master`, `umkm`
- [x] Katalog/Grid Produk/Blog/Form di dalam Container/Columns sekarang tampil di live site
- [x] Panduan client + pengantar diperbarui (dashboard toko, blok UMKM Pro, template UMKM)
- [x] Migration sampai `0069` + integration test dijalankan ke Postgres lokal (DB sementara, sudah dihapus)

## Belum / perlu keputusan

- [ ] **QA manual di browser** — belum dibuka di browser: landing di lebar 360px, editor dengan blok UMKM, alur beli domain → pilih template UMKM → tambah produk → publish
- [ ] **Nama brand** — landing memakai "Web Builder" (konstanta `BRAND` di `apps/web/app/page.tsx`)
- [ ] **Section harga** di landing — belum ada endpoint harga publik (pricing hanya untuk admin/reseller); perlu putuskan harga apa yang ditampilkan
- [ ] **Artikel platform di DB lama** — seed hanya jalan kalau tabel kosong; DB yang sudah ada tetap menyimpan 6 artikel guru (hapus via `/admin/platform-articles` atau migration)
- [ ] **Panduan pengguna** — screenshot masih tampilan lama (capture ulang via `capture-screenshots`), lalu generate ulang `web-builder-guide.html`/PDF (`./generate-pdf-chrome.sh`)
- [ ] **3 tes integrasi lama gagal** (`analytics` TestGetSummary_EncodesDaysParam, `domain_purchase` TestRepo_ExpiryNotice_MarkPreventsResend + TestRepo_AdminList_SortPresets/expires_soon) — gagal identik di commit dasar `guru-only`, bukan regresi pivot. Lokal Postgres 14 vs CI 16; cek hasil CI
