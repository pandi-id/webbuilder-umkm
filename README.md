# Web Builder

Multi-tenant web builder untuk UMKM: toko online di domain `.id` sendiri, dengan editor blok, katalog produk, dan pesanan via WhatsApp.

## Struktur

```
apps/
  api/        # Go Fiber — REST API + auth + domain + Caddy hook
  web/        # Next.js — marketing + dashboard + editor
  renderer/   # Next.js — multi-tenant SSR renderer (by Host)
infra/
  caddy/Caddyfile
  docker-compose.yml
```

## Konfigurasi Environment

Tiap workflow punya file `.env.example` sendiri agar tidak bingung:

| File                          | Dipakai saat...                                  |
|-------------------------------|--------------------------------------------------|
| `infra/.env.example`          | `docker compose up` (orchestration semua service) |
| `apps/api/.env.example`       | `go run ./cmd/server` langsung di host           |
| `apps/web/.env.example`       | `npm run dev` di `apps/web/` (Next.js dashboard) |
| `apps/renderer/.env.example`  | `npm run dev` di `apps/renderer/`                |

Pilih SATU workflow sesuai cara Anda menjalankan, copy `.env.example` → `.env` (atau `.env.local` untuk Next.js), lalu edit nilainya. Lihat header tiap file untuk dokumentasi field.

## Cepat (Docker Compose)

```bash
cd infra
cp .env.example .env             # edit secrets dulu
docker compose up --build
```

Service yang berjalan:

| Service       | URL (dev)                  | Catatan                                |
|---------------|----------------------------|----------------------------------------|
| Dashboard     | http://app.localhost       | Landing, login, dashboard, editor      |
| API           | http://api.localhost       | REST `/api/v1/*`                       |
| Renderer      | http://localhost           | Renderer publik (multi-tenant by host) |
| Postgres      | localhost:5432             | user/pass: `webbuilder/webbuilder`     |
| MinIO console | http://localhost:9001      | `minioadmin/minioadmin`                |

> Catatan: `app.localhost` & `api.localhost` umumnya diresolve oleh OS modern (macOS, Chrome, Firefox). Jika tidak, tambahkan ke `/etc/hosts`:
>
> ```
> 127.0.0.1 app.localhost api.localhost
> ```

## Dev tanpa Docker

API (butuh Go 1.22+ dan Postgres berjalan di `localhost:5432`):

```bash
cd apps/api
cp .env.example .env            # edit DATABASE_URL, dll
go run ./cmd/server
```

Web dashboard (butuh Node 20+):

```bash
cd apps/web
cp .env.example .env.local      # set NEXT_PUBLIC_API_BASE
npm install
npm run dev
```

Renderer:

```bash
cd apps/renderer
cp .env.example .env.local      # set API_INTERNAL_URL
npm install
npm run dev -- -p 3001
```

## Migrations & Seed

**Migrations** dijalankan otomatis saat API start, pakai **Goose v3** (library mode, file di-embed ke binary).

- File: `apps/api/internal/db/migrations/NNNN_*.sql` dengan marker `-- +goose Up` / `-- +goose Down`
- Tracking di tabel `goose_db_version`
- Manual CLI (untuk troubleshoot): `goose -dir apps/api/internal/db/migrations postgres "<DATABASE_URL>" status`

**Seed** dijalankan setelah migrate. Tiga seeder:

| Seeder    | Kapan jalan                                | Apa yang dibuat |
|-----------|--------------------------------------------|---|
| Templates | Selalu                                     | Upsert 15 built-in template |
| Admin     | Saat `ADMIN_EMAIL` + `ADMIN_PASSWORD` set  | User admin (password tidak ditimpa jika user sudah ada) |
| Demo      | Saat `SEED_DEMO=true`                      | User demo + situs UMKM + 5 produk + 3 artikel blog |

Demo data berguna untuk dev/demo cepat. Login dengan `SEED_DEMO_EMAIL` / `SEED_DEMO_PASSWORD` (default `demo@example.com` / `demo1234`).

## Admin Panel

Set `ADMIN_EMAIL` + `ADMIN_PASSWORD` di `.env`. Saat API start:
- Jika user dengan email itu **belum ada**: dibuat baru dengan role `admin`.
- Jika **sudah ada**: passwordnya tidak diubah, hanya role di-force jadi `admin`.

Login dengan email/password tersebut → di header dashboard akan muncul tombol **⚙ Admin Panel** → buka `/admin`.

Admin Panel berisi:
- **Overview** — statistik platform (user, situs, halaman, domain, storage total).
- **User** — list semua user, promote/demote admin, delete.
- **Situs** — list semua situs lintas user dengan usage bar dan **Edit Quota** (set ulang `max_pages` + `max_storage_bytes` per situs).

Membership admin & user benar-benar terpisah secara router:
- `/api/v1/admin/*` butuh JWT + role=admin (lihat `internal/router/admin.go`)
- `/api/v1/*` (selain `/admin`) untuk user biasa (lihat `internal/router/user.go`)
- `/healthz`, `/public/*`, `/internal/caddy/ask`, `/uploads/*` tanpa auth (lihat `internal/router/global.go`)

## Alur Penggunaan

1. Buka http://app.localhost dan daftar akun.
2. Klik **Buat Situs Baru** → pilih template (sekolah/UMKM/portofolio/guru/blog) → isi slug & nama.
3. Edit JSON tree halaman di tab **Editor** (Phase 1 — Craft.js drag-and-drop akan ditambahkan di Phase 2).
4. Sesuaikan warna/font di tab **Tema**.
5. (Opsional) Tambahkan custom domain di tab **Domain**, arahkan A record DNS ke server, klik **Verifikasi**.
6. Klik **Publikasikan** di header.
7. Akses situs di `http://<slug>.localhost` (subdomain platform) atau custom domain Anda.

## Endpoint API utama

```
POST /api/v1/auth/register
POST /api/v1/auth/login
POST /api/v1/auth/refresh
GET  /api/v1/auth/me

GET  /api/v1/templates
POST /api/v1/sites/from-template/:slug

GET    /api/v1/sites
POST   /api/v1/sites
GET    /api/v1/sites/:id
PATCH  /api/v1/sites/:id
DELETE /api/v1/sites/:id
POST   /api/v1/sites/:id/publish

GET    /api/v1/sites/:id/pages
POST   /api/v1/sites/:id/pages
PATCH  /api/v1/pages/:id
DELETE /api/v1/pages/:id

GET    /api/v1/sites/:id/domains
POST   /api/v1/sites/:id/domains
POST   /api/v1/domains/:id/verify
DELETE /api/v1/domains/:id

# Renderer (public, internal)
GET /public/site-by-host?host=<hostname>
GET /public/sites/:id/pages/:slug   # slug "_home" = home page

# Caddy on-demand TLS hook
GET /internal/caddy/ask?domain=<hostname>
```

## Status Fitur

Sudah berjalan:

- ✅ Auth (register/login, JWT access+refresh dengan rotation, argon2id).
- ✅ Sites/Pages/Domains CRUD + ownership check.
- ✅ Multi-tenant renderer by `Host` header (custom domain & `<slug>.localhost`).
- ✅ Caddy `on_demand_tls.ask` hook untuk SSL otomatis di custom domain.
- ✅ 5 template (sekolah, UMKM, portofolio, guru, blog) — 3 halaman per template.
- ✅ Editor block-by-block: tambah/hapus/urutkan block, form properti per-block, preview responsif desktop/tablet/mobile, klik block di preview untuk edit.
- ✅ Theme editor (warna/font/radius) dengan live preview, propagate ke renderer via CSS variables.
- ✅ Asset upload pluggable storage (PNG/JPG/WebP/GIF/SVG, 10 MB) — library + copy URL.
- ✅ Export ke HTML/CSS/JS — zip dengan `index.html`, sub-path per halaman, `assets/css/styles.css`, `robots.txt`, `sitemap.xml`. Streamed langsung dari API, tidak butuh worker.

### Storage backend (pluggable)

Pilih driver lewat `STORAGE_DRIVER`:

| Driver | Cocok untuk                            | Catatan                                                 |
|--------|----------------------------------------|---------------------------------------------------------|
| `local`| Dev tanpa Docker / single-server prod  | File ditulis ke `STORAGE_LOCAL_DIR`, disajikan API di `/uploads/*`. |
| `s3`   | MinIO (self-host) **dan** AWS S3       | Sama-sama pakai protokol S3. Bedanya hanya endpoint + region + SSL. |

Contoh env untuk AWS S3 di Singapore:

```env
STORAGE_DRIVER=s3
STORAGE_S3_ENDPOINT=s3.ap-southeast-1.amazonaws.com
STORAGE_S3_ACCESS_KEY=AKIA...
STORAGE_S3_SECRET_KEY=...
STORAGE_S3_REGION=ap-southeast-1
STORAGE_S3_BUCKET=my-webbuilder-assets
STORAGE_S3_USE_SSL=true
STORAGE_S3_PUBLIC_URL=https://my-webbuilder-assets.s3.ap-southeast-1.amazonaws.com
```

Contoh env untuk MinIO via Docker Compose (default):

```env
STORAGE_DRIVER=s3
STORAGE_S3_ENDPOINT=minio:9000
STORAGE_S3_ACCESS_KEY=minioadmin
STORAGE_S3_SECRET_KEY=minioadmin
STORAGE_S3_USE_SSL=false
STORAGE_S3_BUCKET=assets
STORAGE_S3_PUBLIC_URL=http://localhost:9000/assets
```

Contoh env untuk local disk:

```env
STORAGE_DRIVER=local
STORAGE_LOCAL_DIR=/data/uploads
STORAGE_LOCAL_PUBLIC_URL=http://api.localhost/uploads
```

> Ganti driver = restart API saja. Data lama tetap di tempat lama (tidak otomatis dimigrasi).

Endpoint export tambahan:

```
POST /api/v1/sites/:id/export          # streams zip
GET  /api/v1/sites/:id/assets
POST /api/v1/sites/:id/assets          # multipart "file"
```

Belum:

- Visual drag-and-drop Craft.js (saat ini sudah block-by-block dengan form, sudah cukup workable).
- Versioning halaman (table sudah disiapkan).
- Image processing (resize/optimize) di sisi server.
- Rate limit & Sentry / observability.
- Async export worker (saat ini sync streaming OK untuk situs ≤ ~50 halaman).

## Build
```sh
# One-time setup — build binaries + Next apps
cd apps/api          && go build -o tmp/api ./cmd/server
cd apps/api-registry && go build -o tmp/api-registry ./cmd/server
cd apps/web       && npm ci && npm run build
cd apps/renderer  && npm ci && npm run build

```

## Lisensi

Dirilis di bawah [MIT License](LICENSE) © 2026 PANDI (Pengelola Nama Domain Internet Indonesia) dan kontributor.
