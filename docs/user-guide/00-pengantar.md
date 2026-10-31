# Panduan Pengguna Web Builder — Pengantar

## Tentang Web Builder

Web Builder adalah platform SaaS untuk UMKM membuat toko online sendiri di
domain `.id` tanpa perlu coding. Fitur utama:

- **Toko online siap pakai** — template toko + blok UMKM (etalase produk, promo & voucher, ulasan, info toko) dengan tombol pesan via WhatsApp

- **Editor drag-and-drop** — susun halaman dari block siap pakai (hero, feature grid, produk, blog, form kontak, dsb.)
- **Beli domain terintegrasi** — daftar domain `.id`, `.co.id`, `.com`, dsb. langsung dari wizard
- **Auto-setup Cloudflare** — domain baru otomatis attached ke Cloudflare, DNS + SSL siap pakai
- **Multi-tenant** — 1 platform bisa host ribuan situs pelanggan di domain masing-masing
- **Role-based access** — Admin, Reseller, Agent, Client dengan permission berbeda

## Peran (Role) di Sistem

Ada 4 peran user dengan akses berbeda:

### 1. Client (Pelanggan)

Pengguna akhir — orang yang punya toko/bisnis dan mau bikin situs sendiri.

**Yang bisa dilakukan:**
- Beli domain + bikin situs dari template
- Edit block, tema, konten via editor visual
- Kelola produk, blog, formulir kontak
- Setup DNS + WHOIS domain sendiri
- Perpanjang domain

### 2. Agent (Freelancer / Staff Reseller)

Pekerja lapangan yang dibawahi oleh Reseller. Membantu klien setup situs.

**Yang bisa dilakukan:**
- Lihat klien yang di-assign
- Beli domain untuk klien (**on-behalf-of** — pakai wallet Reseller induk)
- Edit situs klien (jadi collaborator otomatis)
- Lihat statistik pribadi

### 3. Reseller (Mitra Bisnis)

Partner yang jualan produk Web Builder ke pelanggan mereka sendiri, dengan harga jual sendiri.

**Yang bisa dilakukan:**
- Undang Agent ke tim
- Buat & manage klien
- Set harga jual per TLD (untuk agent + untuk client)
- Top-up wallet + lihat ledger transaksi
- Beli domain on-behalf-of klien
- Lihat statistik tim (all agents + revenue)

### 4. Admin (Platform Operator)

Pengelola platform. Punya akses full ke semua data + config.

**Yang bisa dilakukan:**
- CRUD user, situs, template, zone TLD
- Approve reseller applications
- Set harga platform (retail + wholesale)
- Verify top-up wallet + mark invoice paid manual
- Manage Cloudflare configs, promo, payment methods
- Observability: audit log, email log, metrics

## Terminologi Penting

| Istilah | Arti |
|---|---|
| **Situs / Site** | Website milik user, punya domain sendiri + template + isi (halaman, produk, blog) |
| **Domain** | Alamat internet (mis. `tokosaya.id`) yang mengarah ke situs |
| **Zone / TLD** | Ekstensi domain (`.id`, `.co.id`, `.com`) yang di-support platform |
| **Template** | Blueprint desain siap pakai — kategori (UMKM, sekolah, portfolio, dsb.) × variant (modern, clean, professional) |
| **Block** | Komponen halaman (Hero, Feature Grid, Button, Text, Image, Product Grid, dsb.) |
| **Theme** | Setting global site: warna primary/secondary/bg/fg + font heading/body + radius sudut |
| **Wallet** | Saldo internal — dipakai Reseller/Agent untuk bayar domain instan (tanpa gateway) |
| **Invoice** | Tagihan atas transaksi (register domain, renew, top-up wallet) |
| **On-behalf-of (OBO)** | Reseller/Agent trigger transaksi untuk klien — domain jadi milik klien, tapi dibayar reseller |
| **Assignment** | Relasi Reseller ↔ Client atau Agent ↔ Client — kontrol siapa yang boleh manage siapa |

## Alur Umum Pembelian Domain + Buat Situs

Berlaku untuk semua role (client self-service, atau reseller/agent OBO):

```
1. Cari domain di wizard "Beli Domain + Buat Situs"
   └─► Cek availability + harga per TLD (retail/wholesale sesuai role)

2. Konfirmasi: pilih tahun registrasi, metode bayar, promo (opsional)
   └─► Sistem buat invoice → charge via payment gateway atau wallet

3. Setelah bayar (webhook / wallet debit sync):
   ├─► Sistem daftarkan domain ke registrar (via EPP direct)
   ├─► Auto-attach ke Cloudflare (create zone + DNS records)
   └─► Push nameserver Cloudflare ke registry

4. Pilih template → sistem create Situs baru attached ke domain

5. Buka editor → edit konten → Publikasikan → domain live
```

Total waktu dari klik "Beli" sampai domain aktif: **1-5 menit** (tergantung
antrian registrar).

## Cara Login

Semua role login lewat URL yang sama, di-routing otomatis ke dashboard yang
tepat berdasarkan role akun.

1. Buka `https://umkm.pandi.id/login`
2. Masukkan email + password
3. Kalau lupa password: klik "Lupa Password" → email reset link
4. Setelah login, dashboard yang muncul tergantung role:
   - Admin → `/admin`
   - Reseller → `/reseller/dashboard`
   - Agent → `/agent/dashboard`
   - Client → `/dashboard`

## Kontak Support

Kalau ada masalah teknis yang tidak bisa diselesaikan sendiri, hubungi:

- **Email**: (isi sesuai config admin di `/admin/settings`)
- **Telegram/WhatsApp**: (isi sesuai policy operator)

Panduan ini terdiri dari 5 bab per role/fitur — baca bab yang sesuai dengan
peran Anda:

- **Bab 1**: Panduan Client (regular user)
- **Bab 2**: Panduan Agent
- **Bab 3**: Panduan Reseller
- **Bab 4**: Panduan Admin

---

*Panduan ini di-generate dari Web Builder v1 — kalau ada fitur baru yang
tidak tercantum, cek changelog atau hubungi admin.*
