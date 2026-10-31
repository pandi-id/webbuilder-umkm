# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Konteks ini dimuat di setiap sesi. Bekerjalah sebagai senior engineer dengan keahlian gabungan:

## Peran & Skill

- **Go (Fiber) profesional** — REST API produksi, pgx/v5 dengan parameterized query, JWT, argon2id, migrations embedded, layered architecture (handler/repo per domain).
- **UI/UX profesional** — modern, clean, professional, fully responsive. Mobile-first, breakpoints sm/md/lg konsisten, whitespace generous, microcopy ramah bahasa Indonesia.
- **TailwindCSS + shadcn/ui** — utility-first, accessible Radix primitives, dark-on-light defaults. Komponen shadcn di-vendor di `apps/web/components/ui/` (accordion, badge, button, card, dialog, dropdown-menu, input, label, progress, select, separator, table, tabs, textarea). Helper `cn()` di `lib/utils.ts`. Pakai lucide-react untuk ikon. Toast pakai `sonner` (`<Toaster />` sudah dipasang di `app/layout.tsx` — cukup `import { toast } from "sonner"`).
- **Web builder** — block-based editor (skema JSON tree), multi-tenant rendering by Host, custom domain + SSL, export ke static HTML/CSS/JS, asset library, theme tokens (CSS variables).
- **Next.js 16 (App Router)** — RSC + client components (`"use client"`), route groups `(group)`, dynamic segments `[id]`, metadata, server-only fetch dengan `force-dynamic` untuk renderer. Request API async: `await headers()`, `await params`. React 19 gotcha: `inert` wajib boolean (`inert`, bukan `inert=""` — React 19 baca string kosong sebagai false), `useRef<T>(null)` jadi `RefObject<T | null>`, namespace `JSX` pindah ke `React.JSX`.
- **Caddy** — reverse proxy, on-demand TLS dengan ask endpoint, multi-host routing untuk dashboard / api / renderer / custom domain user.

Bahasa user-facing copy: **Indonesia**. Komentar code: English ringkas yang menjelaskan WHY (bukan WHAT).

## Tech Stack

| Layer | Tools |
|-------|-------|
| Backend | Go 1.26 (`go.mod` di `apps/api` dan `apps/api-registry`), Fiber v2, jackc/pgx v5, golang-jwt v5, argon2id, minio-go v7, Goose v3 |
| Frontend | Next.js 16 (App Router) + React 19 di `apps/web` dan `apps/renderer`, TypeScript 5.5, Tailwind 3.4, @dnd-kit (editor DnD), TipTap 3 (rich text) |
| DB | PostgreSQL 16. Migrations embedded di `apps/api/internal/db/migrations/`, auto-applied via `goose_db_version` table |
| Storage | Pluggable: `local` (disk + static serve) atau `s3` (MinIO/AWS S3) — interface `assets.Storage` |
| Renderer | App Next.js terpisah, multi-tenant by `Host` header, `force-dynamic` (cache di Cloudflare, di-purge saat publish via `internal/cachepurge`) |
| Proxy | Caddy 2 dengan on-demand TLS → `/internal/caddy/ask?domain=` |

## Arsitektur

```
apps/api/        Go Fiber API
  cmd/server/    main.go (tipis: wire deps + listen)
  internal/
    router/      MountGlobal / MountUser / MountAdmin
    auth/        register/login/JWT + RequireAdmin
    sites/ pages/ domains/ assets/ exports/ templates/ usage/ admin/
    public/      Read-only API untuk renderer
    caddy/       on_demand_tls.ask hook
    httpx/       Response envelope + Paginated[T]
    db/          Connect + Migrate (migrations/ embedded di sini)
    reseller/    Portal reseller/agent — semua query scope by manager_id
    dnsprovider/ Interface DNS backend; adapter di cloudflare/ + dnscloud/, config di dns_providers/
    site_byo_domains/  BYO domain .id via delegasi NS Cloudflare
    settings/    Key-value config yang admin ubah tanpa redeploy (PPN, brand)
    audit/ email_log/ errortrack/  Observability (fire-and-forget, tidak block request)

apps/api-registry/  Go service internal: EPP execution (check/register/renew/NS/WHOIS), port 5000, HMAC-auth dari api
apps/web/        Dashboard + visual editor (private, JWT) — portal per role
apps/renderer/   Public multi-tenant SSR
infra/caddy/     Caddyfile
docs/qa-playwright/  E2E suite Playwright (smoke/regression/visual)
ecosystem.config.js  PM2 — cara prod jalan (bukan Docker)
```

**Role user**: login mengarah ke `/admin` untuk admin, dan `/dashboard` untuk semua role lain —
**termasuk reseller dan agent**. Keduanya umumnya user biasa yang dipromosikan belakangan, jadi
mereka tetap punya situs + domain lama; kalau login langsung melempar ke portal, aset itu hilang
dari pandangan. Perpindahan ke portal lewat tombol di header (sebelah profil), balik lewat tombol
"Toko Saya" di portal. Dua mapping-nya di [lib/roles.ts](../apps/web/lib/roles.ts):
`defaultRouteForRole()` (tujuan login) + `portalForRole()` (tombol portal: href/short/label/icon).
Tambah role berportal = cukup sentuh file itu, jangan hardcode `role === "admin"` di layout.
`dashboard/layout.tsx` **tidak boleh** redirect reseller/agent keluar. Portal `/agent/*` dan
`/reseller/*` tetap menolak role yang tidak cocok. Middleware API: `auth.RequireAdmin/RequireReseller/RequireAgent`.
Reseller mengundang agent/client (`invitation_repo.go`, `parent_reseller_id`); penerimaan undangan
agent sengaja mendarat di portal agen, bukan `/dashboard` (user baru belum punya toko).

**Tambah klien yang sudah punya akun ikut memperbarui profilnya.** Field yang diisi caller
menimpa data lama; field kosong jadi `nil` → `UpdateProfile` COALESCE mempertahankan nilai
tersimpan (helper `profileUpdateFrom`). Dulu semua field dibuang diam-diam, jadi form terasa
tidak tersimpan. Response membawa `profile_updated` supaya UI bisa bilang apa yang berubah.

**Dashboard `/dashboard` hanya situs milik sendiri.** `GET /sites` default mengembalikan
gabungan owner + kolaborator (lewat `site_members`); dashboard memanggil `?role=owner` supaya
reseller/agent dengan banyak klien tidak bingung mana toko sendiri. Situs klien tampil di
`MyCollaborationsList` (`GET /collaborations`) yang membawa `site_status`, `hostname`
(domain `verified` saja, via LATERAL) dan `updated_at`. `/settings/collaborators` memuat
KEDUA arah — kolaborator di situs saya + situs yang saya kelola — karena client biasa yang
diberi akses editor tidak punya portal sendiri. Catatan: `sites.GetOwned` sebenarnya mengecek
keanggotaan `site_members` (bukan `sites.user_id`), jadi kolaborator memang boleh buka
`/sites/:id`; namanya saja yang menyesatkan.

**Hapus klien = lepas penugasan, BUKAN hapus akun.** `DELETE /{reseller,agent}/clients/:id`
set `access_status='revoked'` (`RevokeAssignment`, scoped by manager). Klien punya situs +
domain sendiri dan banyak yang daftar sendiri sebelum dikelola — menghapus akunnya dari sini
merusak data milik orang lain. `CreateAssignment` pakai `ON CONFLICT … DO UPDATE … WHERE
access_status='revoked'` supaya pelepasan bisa dibatalkan; tanpa itu unique index
`(manager_id, client_id)` bikin klien yang dilepas tidak pernah bisa ditambah lagi.
Penugasan yang masih aktif tetap `ErrAlreadyAssigned` (DO UPDATE ter-filter → `pgx.ErrNoRows`).

**`has_login` vs `email_verified`.** Tombol "Kirim ulang undangan" HANYA untuk akun yang belum
punya cara login (`password_hash = '' AND oauth_google_sub IS NULL`). Jangan pakai
`email_verified` sebagai penanda "belum accept" — user yang daftar sendiri bisa punya password
tapi email belum terverifikasi, dan mengirim ulang undangan ke mereka berarti menyerahkan link
set-password akun orang ke managernya. `ResendClientInvite` menolak dengan 409 kalau sudah ada login.

**Tambah klien dengan email yang sudah terdaftar**: `POST /reseller/clients` TIDAK mengirim
undangan set-password untuk user existing (mereka sudah punya password) — hanya email
pemberitahuan `sendClientLinkedEmail` bahwa akunnya kini dikelola manager tsb. Response
membedakan `invite_sent` (link set-password) dari `email_sent` (email apa pun terkirim);
UI wajib membaca flag itu, jangan hardcode "email terkirim". Assignment dibuat tanpa
persetujuan klien — hanya diberitahu. Kalau nanti butuh persetujuan, ikuti pola invitation
agent di bawah.

**Promosi user lama jadi agent**: `POST /reseller/agents/invite` menerima email yang SUDAH terdaftar
— invitation dibuat dengan `target_user_id` sehingga akun lamanya (beserta situs + domain) dinaikkan
jadi agent, bukan bikin akun baru. Kelayakan dipusatkan di `reseller.agentInviteBlocker()`: hanya
role `client` yang boleh; reseller/admin/agent-orang-lain ditolak, begitu juga klien yang sedang
dikelola manager lain. Dialog undang memanggil `GET /reseller/agents/lookup?email=` (exact-match,
rate-limited, bukan listing — jangan diubah jadi pencarian bebas, itu membocorkan basis user).
Di `AcceptInvitationTx`, password **hanya** di-set kalau akun belum punya cara login sama sekali
(`password_hash = '' AND oauth_google_sub IS NULL`) — hash kosong saja bukan penanda, user Google
juga kosong. Password yang sudah ada tidak pernah ditimpa.

**Next 16 `params` di client component**: `params` adalah **Promise**, termasuk di komponen
`"use client"`. Membacanya sebagai prop (`function Page({ params }: { params: { x: string } })`)
menghasilkan `undefined` — dan `tsc` TIDAK menangkapnya karena validator Next memakai `& any`.
Pakai `useParams<{ x: string }>()` di client, `await params` di server. Bug yang pernah terjadi:
`/invite/[token]` fetch ke `/api/v1/invitations/undefined` → 404 → setiap undangan, sesegar apa pun,
tampil "Undangan tidak berlaku".

**Next 16 `proxy.ts`**: `middleware.ts` sudah di-rename ke `proxy.ts` di kedua app Next. Isinya generate CSP nonce per request (tanpa `unsafe-inline`/`unsafe-eval` di `script-src`). Embed pihak ketiga baru (iframe/script) wajib ditambah ke CSP di sana. `Vary: Host` ditegakkan di Caddy, bukan di proxy.ts (Next 16 menimpanya).

## Konvensi API

- Endpoint hierarchy:
  - **Global** (tanpa auth): `/healthz`, `/public/*`, `/internal/caddy/ask`, `/uploads/*` (saat driver=local)
  - **User** (JWT): `/api/v1/*`
  - **Admin** (JWT + role=admin): `/api/v1/admin/*`
- Envelope: success `{ "data": ... }`, error `{ "error": { "code", "message" } }`. Gunakan helper `httpx.OK / Created / BadRequest / Unauthorized / Forbidden / NotFound / Conflict / Internal`.
- **Pagination**: `?page=&page_size=&q=&sort=`. Response: `Paginated<T>` = `{ items, page, page_size, total, total_pages }`. Pakai `httpx.ParsePagination` + `httpx.MakePaginated`. Search via `LikePattern()` (kosong = `%`, jadi 1 query saja).
- **Sort presets**: whitelist di repo (`orderUsersSQL`, `orderSitesSQL`) — JANGAN pernah interpolasi raw user input ke `ORDER BY`.
- JWT bearer di header `Authorization: Bearer <access>`. Access TTL 15m, refresh TTL 7d dengan **rotation** (revoke old, issue new).
- **Ownership check wajib**: setiap query selalu `WHERE user_id = $current_user`. Jangan trust ID dari request.
- Quota enforcement di handler (bukan repo): load site → cek `count >= QuotaMaxPages` atau `used + new > QuotaMaxStorageBytes` → return 403 dengan pesan rinci.

## Konvensi Frontend

- **Microcopy ID**: "Buat Situs Baru", "Hapus", "Simpan", "Batal", "Tersimpan ✓", "Pilih font…".
- **shadcn-first**: untuk komponen umum (Button, Card, Input, Label, Badge, Dialog, Select, Table, Tabs, Progress, Separator) **wajib** pakai komponen dari `@/components/ui/*`. Jangan tulis utility class custom yang sudah ada equivalent shadcn.
- **Ikon**: pakai lucide-react (`import { Plus, Pencil } from "lucide-react"`). Jangan pakai emoji untuk ikon yang punya equivalent lucide.
- **Color tokens**: pakai shadcn semantic (`bg-primary`, `text-muted-foreground`, `border`, `bg-card`, `text-destructive`). `brand-*` dan slate explicit hanya untuk legacy yang belum di-port.
  - Status semantic mapping: `published` → Badge `variant="success"`; `draft`/`pending` → `secondary`; `verified` → `success`; `failed`/danger → `destructive`; admin/warning → `warning`.
- **Cards**: `<Card>` + `<CardHeader>` + `<CardTitle>` + `<CardContent>`. Untuk tabel full-bleed: `<Card className="overflow-hidden p-0">`.
- **Dialog**: `<Dialog open={open} onOpenChange={setOpen}>` + `<DialogContent>` + `<DialogHeader><DialogTitle>...<DialogDescription>` + `<DialogFooter>`. Tombol close (X) sudah included.
- **Form**: `<Label htmlFor>` + `<Input id>` + `space-y-1.5` di wrapper. Error message: `<p className="text-sm text-destructive">`.
- **Form kontak (profil, klien)**: field yang berakhir di EPP `contact:create` dipakai bersama —
  aturannya ada di [lib/contact.ts](../apps/web/lib/contact.ts) (`asciiError`, `postalCodeError`,
  `nikError`), jangan tulis ulang per form. Provinsi/kota WAJIB pakai `ProvinceSelect`/`CitySelect`
  dari [WilayahSelect.tsx](../apps/web/components/WilayahSelect.tsx), bukan input teks bebas —
  teks bebas menghasilkan nilai non-ASCII yang bikin EPP gagal "Transaction rolled back".
  Negara pakai `<CountryBadge>` (Indonesia, fixed): platform ID-only dan `CountryCode: "ID"`
  di-hardcode di `domain_purchase`, jadi dropdown negara sungguhan akan berbeda diam-diam
  dari yang didaftarkan ke registry.
- **Form panjang pakai halaman, bukan dialog**: produk, artikel, dan klien
  ([components/clients/ClientForm.tsx](../apps/web/components/clients/ClientForm.tsx), dipakai
  bersama portal agent + reseller lewat prop `basePath`). Dialog hanya untuk form 1-2 field.
- **Tabs nav (header level)**: pakai `<Link>` dengan `border-b-2` pattern di `apps/web/app/sites/[id]/layout.tsx` (bukan Radix Tabs — untuk navigasi route).
- **Loading**: dim tabel `className={loading ? "opacity-60" : ""}` di `<TableBody>`. Skeleton: `animate-pulse rounded-md bg-muted/50`.
- **Empty states**: copy berbeda untuk "belum ada data" vs "tidak ada hasil untuk \"X\"".
- **Live search**: `useDebounced` dari `components/Pagination.tsx` (300ms default), reset `page=1` saat query atau sort berubah.
- **Theme tokens** (untuk situs yang di-render, BUKAN dashboard) mengalir ke renderer via CSS variables (`--color-primary`, `--font-heading`, `--radius`). JANGAN hardcode `brand-*` di renderer atau exported CSS.

## Konvensi Go

- **Layered**: repo punya SQL, handler punya validasi + auth + dispatch. Handler TIDAK menulis SQL.
- **Sentinel errors** per package: `ErrNotFound`, `ErrSlugTaken`, `ErrJobTaken`. Bandingkan dengan `errors.Is`.
- **Constructor**: `NewRepo(pool)` / `NewHandler(repo, ...)` — injected, tanpa global state.
- **Pgx**: selalu `defer rows.Close()` setelah `pool.Query`, dan return `rows.Err()` di akhir loop.
- **Generics** untuk shared types: `Paginated[T]`, `MakePaginated[T]`.
- **Unique violation**: cek `pgErrCode(err) == "23505"` → return sentinel `Err*Taken`.
- **JSON null handling**: pointer field untuk optional input (`*string`, `*int`), `COALESCE($n, col)` di UPDATE.
- **UPDATE dinamis**: kalau ada kolom kondisional (mis. `stock` yang bisa NULL/angka/tak-diubah),
  nomori placeholder **saat argumen di-append**, jangan tulis `$2..$11` manual. Pola aman ada di
  `products.Repo.Update` (helper `set(col, v)` yang append arg + rakit klausa sekaligus). Pernah
  bikin bug: satu argumen kondisional disisipkan di tengah → semua kolom sesudahnya baca nilai
  milik kolom lain → `column "stock" is of type integer but expression is of type text` (500).

## Environment Files

Empat file `.env.example` terpisah agar tiap workflow jelas isinya:

| File                          | Workflow                                          |
|-------------------------------|---------------------------------------------------|
| `infra/.env.example`          | Docker Compose orchestration (`cd infra && docker compose up`) |
| `apps/api/.env.example`       | Go API direct dev (`go run ./cmd/server`)         |
| `apps/web/.env.example`       | Next.js dashboard dev (`npm run dev`)             |
| `apps/renderer/.env.example`  | Next.js renderer dev (`npm run dev`)              |

Aturan saat menambah env baru:
- API baca dari OS env → daftarkan di [config/config.go](apps/api/internal/config/config.go) + dokumentasikan di `apps/api/.env.example` + jika perlu passthrough Docker, tambahkan di `infra/docker-compose.yml` (env `${VAR:-default}`) + di `infra/.env.example`.
- Frontend env publik (browser-visible) **wajib** prefix `NEXT_PUBLIC_` dan masuk ke `apps/web/.env.example`.
- Renderer server-to-server env (tanpa `NEXT_PUBLIC_`) masuk ke `apps/renderer/.env.example`.
- Jangan duplikasi env di banyak file kalau tidak perlu — user bingung mana yang authoritative.

Next.js auto-load `.env.local` (jangan commit). API perlu `.env` di dir tempat `go run` dijalankan + dotenv loader/`source`.

## Migrations

- **Goose v3** (`github.com/pressly/goose/v3@v3.21.1`) untuk schema migrations. Library mode, embedded via `embed.FS`, auto-applied saat startup.
- File baru: `apps/api/internal/db/migrations/NNNN_description.sql` dengan format goose:
  ```sql
  -- +goose Up
  CREATE TABLE IF NOT EXISTS ...;

  -- +goose Down
  DROP TABLE IF EXISTS ...;
  ```
- Idempotent saat memungkinkan: `CREATE TABLE/INDEX IF NOT EXISTS`, `ALTER TABLE ADD COLUMN IF NOT EXISTS`, `DROP ... IF EXISTS` di Down.
- Multi-statement function/DO block butuh `-- +goose StatementBegin` / `-- +goose StatementEnd`.
- Tracking: `goose_db_version` table.
- Legacy compat: `internal/db/migrate.go::importLegacyMigrationState` otomatis migrasi dari `schema_migrations` (custom runner lama) ke `goose_db_version` pada startup pertama setelah upgrade.
- JANGAN edit migration yang sudah di-apply — selalu buat file baru.

## Seed

- Package `apps/api/internal/seed/` (idempotent, dipanggil dari `main.go` setelah migrate).
- `seed.Run(ctx, Deps, Options)` mengeksekusi:
  - **`Templates`** — selalu jalan, upsert built-in template dari `templates.BuiltinTemplates()`.
  - **`Admin`** — jalan kalau `ADMIN_EMAIL` + `ADMIN_PASSWORD` set. Idempotent: kalau user sudah ada, hanya force role=admin, password tidak diubah.
  - **`Demo`** — opt-in via `SEED_DEMO=true`. Buat 1 user demo + 1 situs UMKM + 5 produk + 3 artikel blog Markdown. Skip total kalau user demo sudah ada.
- Tambah seeder baru = tambah function di `seed.go` + panggil dari `Run`.

## Caddy

- `Caddyfile` di `infra/caddy/Caddyfile`. On-demand TLS memanggil API `/internal/caddy/ask?domain=<host>` sebelum issue cert.
- Custom domain user wajib lolos:
  1. Tambah hostname di tab Domain → status `pending`
  2. Klik **Verify** → API lookup DNS A record → status `verified`
  3. First-time hit → Caddy ask → API allow → ACME → cache cert
- `:443` catch-all → `reverse_proxy renderer:3000`. Renderer route by `Host` header.

## Admin

- Bootstrap via env: `ADMIN_EMAIL` + `ADMIN_PASSWORD` (+ optional `ADMIN_NAME`) → `EnsureAdmin` saat startup (idempotent; password tidak diubah kalau user sudah ada).
- Tombol **⚙ Admin Panel** muncul di dashboard header kalau `role === "admin"`.
- Admin bisa edit quota per situs (`PATCH /admin/sites/:id/quota`), promote/demote user, hapus user/situs.
- Sidebar ([app/admin/layout.tsx](../apps/web/app/admin/layout.tsx)) — satu sumber nav, tambah menu baru di situ:
  Overview, Pengguna, Reseller, Situs, Aset, Artikel Platform, Template, Pricing, Promo,
  Zones, Payment, Invoices, Wallet Top-up, Settings, Domain, DNS Provider, Audit Log, Email Log.

## Quota & Usage

- Per situs: `quota_max_pages` (default 20), `quota_max_storage_bytes` (default 100 MB).
- Tabel `site_usage_snapshots` untuk historical report (append-only, auto-pruned ke 100 terakhir).
- Endpoint `GET /sites/:id/usage` mengembalikan live + simpan snapshot.
- UI: bar `bg-emerald-500` (<70%), `bg-amber-500` (70-89%), `bg-red-500` (≥90%).

## Verifikasi Build

Perintah yang dijalankan CI (`.github/workflows/ci.yml`) — cocokkan lokal sebelum commit.

**API (Go)** — wajib lolos untuk semua perubahan backend:

```bash
cd apps/api
go vet ./...
go build ./...
go test -race -timeout 90s ./...            # semua paket
go test -race -run TestName ./internal/pkg  # single test / paket tertentu
```

Integration test yang butuh Postgres: set `TEST_DATABASE_URL` (contoh:
`postgres://test:test@localhost:5432/webbuilder_test?sslmode=disable`). Kalau
kosong, test SKIP otomatis. CI selalu set (Postgres service di
[.github/workflows/ci.yml](../.github/workflows/ci.yml)).

**Dashboard (Next.js)**:

```bash
cd apps/web
npm run typecheck    # tsc --noEmit
npm run build        # next build (butuh NEXT_PUBLIC_API_BASE)
```

**Renderer (Next.js)**:

```bash
cd apps/renderer
npm run typecheck
npm run build        # baca API_INTERNAL_URL (fallback http://localhost:8080)
```

**api-registry (Go)** — tidak ada di CI, jalankan manual kalau menyentuhnya:

```bash
cd apps/api-registry && go vet ./... && go test -race ./...
```

**E2E Playwright** (`docs/qa-playwright/`, butuh stack jalan + `.env` dengan `BASE_URL`, `API_BASE`, kredensial per role):

```bash
cd docs/qa-playwright
npm run test:smoke                       # @smoke, dipakai di PR
npm run test:regression                  # semua (tests/ + functional/ negative/ security/ visual/)
npm run test:client                      # per role: client|agent|reseller|admin|auth|security
npx playwright test tests/10-client.spec.mjs -g "nama test"   # single test
```

CI trigger di branch `main`, `master`, dan `umkm`.

Tidak perlu start dev server otomatis kecuali user minta. Kalau perlu dev:
`go run ./cmd/server` (API :8080, atau `air` untuk hot-reload, config [apps/api/.air.toml](../apps/api/.air.toml)), `go run ./cmd/server` di `apps/api-registry` (:5000), `npm run dev` di web (:4000) dan renderer (:4001 — port sudah di script, jangan tambah `-p`).

**Prod** jalan via PM2 ([ecosystem.config.js](../ecosystem.config.js)), bukan Docker: build Go binary ke `tmp/` + `npm run build`, lalu `pm2 restart`. Perubahan `NEXT_PUBLIC_*` butuh rebuild, bukan cuma restart.

## Editor Internals (apps/web/app/sites/[id]/editor/)

Block tree adalah `BlockData[]` (JSON) dengan bentuk `{ type, props, children?, layout?, themeOverride? }`. Semua operasi tree **immutable & path-based** — path = array of sibling indices (`[3, 0, 1]` = anak ke-2 dari anak ke-1 top-level block #3).

- **[paths.ts](../apps/web/app/sites/[id]/editor/paths.ts)** — SATU-SATUNYA sumber untuk mutasi tree. Fungsi: `getAt`, `updateAt`, `removeAt`, `removeMany`, `insertAt`, `duplicateAtPath`, `moveAtPath`, `reorderSiblings`, `movePath`, `pathKey`/`keyToPath` (Set membership + React keys), `samePath`, `isChildOf`. **Semua return tree baru** dengan hanya spine yang di-copy → memo React tetap valid.
- `movePath` menolak drop ke sub-tree diri sendiri (mencegah orphan). `removeMany` sort deepest-first supaya index-shift tidak melenceng.
- **[PropEditor.tsx](../apps/web/app/sites/[id]/editor/PropEditor.tsx)** — schema-driven form per block type. Blok baru = tambah schema + renderer di sini.
- **[SortableBlockList.tsx](../apps/web/app/sites/[id]/editor/SortableBlockList.tsx)** — @dnd-kit sortable, panggil `reorderSiblings`/`movePath`.
- **[useBlocksHistory.ts](../apps/web/app/sites/[id]/editor/useBlocksHistory.ts)** — undo/redo stack, kapasitas fixed.

Ketika menambah tipe blok baru, sentuh 4 tempat: (1) schema di `apps/web/lib/blocks.ts` (PropEditor membaca schema ini), (2) preview editor di `editor/page.tsx`, (3) renderer di `apps/renderer/components/Blocks.tsx` (`switch (block.type)`), (4) exporter di `apps/api/internal/exports/` (`render*.go` + CSS `.wb-*` di `styles*.go`). Tipe blok yang tidak dikenal (mis. blok `Guru*` di situs lama) wajib dirender kosong di ketiga sisi, jangan error.

## Renderer (apps/renderer)

- **Catch-all**: `app/[...slug]/page.tsx` lookup `Host` header → `GET /public/site-by-host?host=...` → `GET /public/sites/:id/pages/:slug` (slug kosong = `_home`).
- **Route spesifik** menang atas catch-all: `blog/[slug]`, `produk/`, plus `sitemap.xml` / `robots.txt`.
- **Caching**: semua page `force-dynamic`; cache edge di Cloudflare, di-purge saat publish (`internal/cachepurge`, fire-and-forget).
- **Preview**: `_preview/[token]` untuk draft (dari dashboard iframe); `template-preview/*` + `template-preview-by-id/*` untuk template picker.
- **Dynamic blocks**: `ProductGridDynamic`, `BlogListDynamic` fetch dari `/public/sites/:id/products` & `/blog` — jangan hard-code data.
- **Theme tokens** dari site JSON diinject sebagai CSS variables di `<style>` inline di layout (`--color-primary`, `--font-heading`, `--radius`). Blok pakai `var(--color-primary)`, bukan `bg-primary` Tailwind class.

## Domain Purchase Flow (self-sufficient)

**Konsep produk**: **1 domain = 1 situs**. User HARUS beli domain dulu sebelum bisa create situs — tidak ada free subdomain flow. `POST /sites/from-template/:slug` wajib `job_id` di body; atomic create + attach. Tidak ada batas jumlah situs per user. `POST /sites` (tanpa domain) **admin-only** untuk QA/support — jangan dibuka untuk role lain. Pengecualian: BYO domain `.id` yang sudah dimiliki user di-attach lewat tab Domain (`internal/site_byo_domains`, delegasi NS ke Cloudflare via `dnsprovider`).

**Arsitektur** (Phase 3 self-sufficient):
- Web builder = authoritative source untuk **invoice + payment + wallet + document + promo**.
- EPP execute (register/renew/whois/nameserver) di-route lewat internal service [apps/api-registry](../apps/api-registry/) via HMAC-signed HTTP.
- Client wrapper: [apps/api/internal/registrar/](../apps/api/internal/registrar/) — `Client.CheckDomain / RegisterDomainDirect / RenewDomainDirect / GetNameservers / UpdateNameservers / Whois / UsesAPIRegistry`. Zero coupling ke external registrar-api PANDI.
- Local job tracker: [apps/api/internal/domain_purchase/](../apps/api/internal/domain_purchase/) — canonical status source, `job_id = invoice.ID` di V2 flow.

**Env yang wajib**:
- `API_REGISTRY_URL` (kalau kosong = fitur domain disabled)
- `API_REGISTRY_HMAC_SECRET` (must match api-registry `INTERNAL_HMAC_SECRET`)
- `API_REGISTRY_TIMEOUT` (default 30s)

**Local packages** yang menopang flow:
- [invoices](../apps/api/internal/invoices/) — invoice state machine (draft → unpaid → paid) + PDF renderer + PPN
- [paymentgw](../apps/api/internal/paymentgw/) — gateway registry (Midtrans, Paylabs, manual_bank, deposit_wallet)
- [paymentwh](../apps/api/internal/paymentwh/) — webhook receiver `/webhooks/payment/:code` → MarkPaid + ExecuteAfterPayment callback
- [wallet_local](../apps/api/internal/wallet_local/) — balance + ledger (append-only) + admin adjust
- [documents_local](../apps/api/internal/documents_local/) — KTP/NPWP library, blob di assets.Storage
- [promos](../apps/api/internal/promos/) — kupon diskon (validate + redeem, unique per invoice_id)

**User flow end-to-end**:
1. Dashboard → **"Beli Domain + Buat Situs"** (satu-satunya CTA create — free subdomain flow sudah dihapus)
2. `/sites/new-with-domain` — wizard: cari domain → cek availability + zone flags (`require_document`, `auto_approved`) → confirm dengan profile check (nama/HP/alamat/kota/kode pos + NIK kalau .id) + opsional promo code (validate via `POST /promos/validate`)
3. `POST /api/v1/domains/purchase` dengan header `Idempotency-Key: <uuid>` → invoice created lokal + payment charge via paymentgw → `{ job_id, payment_url }`
4. Navigate ke `/sites/pending/[jobId]` — polling 3s status:
   - `pending_payment` → tombol "Buka halaman pembayaran" (Midtrans/Paylabs) atau langsung `active` untuk `deposit_wallet` (sync flow)
   - `pending_provisioning` → wait ExecuteAfterPayment → `RegisterDomainDirect` via api-registry
   - `failed` → **tombol "Coba lagi"** (`POST /purchases/:job_id/retry` — re-run ExecuteAfterPayment, TIDAK bayar ulang)
   - `active` → **TemplatePicker** → `POST /sites/from-template/:slug { job_id }` atomic create+attach → editor
5. Payment gateway webhook `/webhooks/payment/:code` → paymentwh verify signature → MarkPaid → ExecuteAfterPayment → EPP CREATE via api-registry
6. Dashboard poll `/domains/purchases` tiap 30s — kartu "Domain sedang diproses" update tanpa reload

**Sub-flow yang sudah live**:
- **Renew**: `POST /api/v1/domains/:name/renew` → jobs `kind=renew`. UI reuse `/sites/pending/[jobId]` — kalau `kind=renew` template picker skipped, ganti dengan kartu "Perpanjangan berhasil". Wallet payment sync (`deposit_wallet`) langsung `active`.
- **Nameserver + WHOIS**: [/settings/domains/[name]](../apps/web/app/settings/domains/) — user edit NS (min 2, max 13, hostname regex client-side) + view WHOIS via api-registry. Semua ownership-verified.
- **Documents**: [/settings/documents](../apps/web/app/settings/documents/) — library KTP/NPWP user, upload multipart ke `POST /documents` (metadata di `documents` table + blob di assets.Storage). Preview via `GET /documents/:id` (base64 data URI). Dipakai wizard sebagai pre-attach `document_ids[]` saat purchase TLD yang require_document.
- **Promos**: [/admin/promos](../apps/web/app/admin/promos/) — admin CRUD kupon (percent/fixed, applies_to register|renew|both, TLD whitelist, min subtotal, max cap, valid window, max uses total + per-user). User apply via wizard: input code → validate preview → submit purchase with `promo_code`. Redemption tracked di `promo_redemptions` (unique per invoice_id), audit event `promo.applied` fires setelah redeem sukses.
- **Expiry email notifier**: [internal/notifier/expiry.go](../apps/api/internal/notifier/expiry.go) — background goroutine, scan tiap 24 jam. Kirim email peringatan per user (Bahasa Indonesia + deep-link `/settings/domains/<domain>`) untuk domain aktif expire ≤ 30 hari, dedup via kolom `expiry_notice_sent_at` + resend 7 hari.
- **Dashboard banner**: 2 kartu — "Domain sedang diproses" (pending states) + "Domain akan segera expire" (< 30 hari). Filter dedupe per-domain (`latestActivePerDomain`) supaya post-renewal user tidak lihat tanggal lama.
- **Admin observability**: [/admin/domain/purchases](../apps/web/app/admin/domain/purchases/) — paginated + filter status/kind/search, join users untuk email. `GET /api/v1/admin/registrar/purchases` pakai `AdminList` repo method dengan whitelist sort preset.
- **Hardening**:
  - Payment webhook rate-limit 600/60s per source IP (defence in depth di atas gateway HMAC verify).
  - Idempotency-Key WAJIB di `POST /domains/purchase` + `/renew` (frontend generate `useMemo` UUID) — cegah double-charge.
  - Wallet payment untuk purchase reseller/agent-only (client role dilarang).
  - Metrics counters di [/metrics](../apps/api/internal/router/global.go): `domain_purchase_created_total{result,gateway}`, `domain_renew_created_total{result,gateway}`, `payment_webhooks_total{code,result}`, `domain_purchase_execute_after_payment_total{result,kind}`, `domain_expiry_notices_total{result=sent|failed}`.

**Yang harus dijaga saat kerja di area ini**:
- Ownership check di setiap endpoint (`GetByJobIDForActor(jobID, userID)` inklusif ke `purchased_by` untuk on-behalf-of) — cegah URL guessing.
- Idempotency-Key WAJIB di POST /purchase + /renew — cegah double-charge.
- Promo validate + redeem race-safe: unique index di `promo_redemptions(invoice_id)` cegah dobel-redeem per invoice. Test via `TestRepo_InsertRedemption_UniqueInvoice` di `internal/promos`.
- On-behalf-of validation: `CanRegisterForClient(caller)` + `HasActiveAssignment(caller, client)` sebelum owner switch. `PurchasedBy` disimpan di invoice + purchase.
- Error dari api-registry di-translate ke `registrar.APIError` (via `translateAPIRegistryErr`). Konsumer pattern-match `errors.As(err, &apiErr)` — jangan string-match message.
- **Dedupe expires_at per domain di frontend**: setelah renew, register-row punya expires_at lama, renew-row punya yang baru. Pakai `latestActivePerDomain(items)` helper (di dashboard + settings/domains).
- `lib/api.ts` throw `ApiError` (subclass Error dengan `.status` + `.code`) — pattern-match status 404/403 untuk friendly screen.

## Fokus Produk: UMKM

Branch `umkm` adalah pivot dari "Website Pribadi Guru" (PANDI × UPI) ke toko online UMKM.
Fitur guru (Tulisan per rubrik, Forum, Pembelajaran, Tanggapan, Ruang Promosi/banner,
Profil Guru, portal `/guru`, integrasi Litera, template `guru-pandi*`/`teacher`) sudah
dihapus dari kode. Tabel `guru_*`, `litera_*` dan kolom profil guru di `users` sengaja
dibiarkan di DB (migration lama tidak diedit; `0069` hanya menghapus baris template guru).

- **Artikel** = blog per situs (`internal/blog`, dashboard `sites/[id]/blog`, renderer `blog/[slug]`) + artikel platform `/artikel`.
- **Template picker** (wizard `sites/pending/[jobId]`) hanya menampilkan kategori `umkm`.
- **Dokumentasi publik** `/panduan` (`apps/web/app/panduan/page.tsx`) membaca `docs/user-guide/10-panduan-client.md` saat runtime (path `../../docs` dari cwd `apps/web`) — folder `docs/` wajib ikut ter-deploy. Gambar screenshot sengaja disembunyikan sampai di-capture ulang untuk UI UMKM.
- **Landing** (`apps/web/app/page.tsx`) satu-satunya tempat yang memakai `motion` (`motion/react`), di client island `components/landing/*`. Jangan pakai motion di dashboard/renderer.
- **Dashboard situs** komponennya di `components/site-dashboard/`; checklist onboarding memakai `PLACEHOLDER_BRANDS` di `app/sites/[id]/page.tsx` — tambah brand Navbar default template baru ke situ.
- **Keranjang & Pesanan**: keranjang di browser (`apps/renderer/components/cart/`, `lib/cart.ts`, localStorage `wb-cart:v1:<siteId>`) → `POST /public/sites/:id/orders` (`internal/orders`). API re-price dari DB (jangan percaya harga client), potong stok di transaksi yang sama (`stock IS NULL` = tak terbatas), `seq` per situs → `#0042`; batal mengembalikan stok. Hanya situs **published**. Checkout via WhatsApp ke `sites.whatsapp_number` — tidak ada payment gateway untuk toko (Midtrans/Paylabs yang ada = akun platform untuk domain). Dashboard: `sites/[id]/orders`. Tombol keranjang masuk ke `UmkmBlocks` lewat hook opsional `ctx.cartButton` (editor tidak set → tetap tombol WA).
- **Produk & Ulasan**: form produk adalah **halaman penuh** (`products/new`, `products/[productId]/edit`
  + `ProductForm.tsx`), bukan dialog — pola sama dengan `BlogForm` (sticky toolbar, autosave 3 detik
  di mode edit, dirty guard). `products.description` berisi **Markdown** dari `<RichEditor>`; renderer
  parse lewat `marked` + class `.wb-prose`. Untuk excerpt kartu & meta SEO pakai `plainExcerpt()` di
  `lib/umkm.ts` (jangan `.slice()` Markdown mentah). Ulasan di `internal/reviews`: pengunjung kirim via
  `POST /public/sites/:id/products/:slug/reviews` (honeypot `_hp` + rate-limit 5/10 menit per IP),
  masuk status `pending` → pemilik approve di `sites/[id]/reviews`. Badge "Pembeli terverifikasi"
  di-resolve **sekali saat submit** (cocokkan `author_phone` ternormalisasi dengan `orders.customer_phone`
  di situs yang sama, order non-`cancelled`) supaya pesanan yang dihapus belakangan tidak mengubah
  ulasan yang sudah tayang. `author_phone` tidak pernah keluar di API publik. Breakdown bintang dihitung
  di SQL (`COUNT(*) FILTER`) atas SELURUH ulasan published — jangan hitung dari item yang ter-`limit`.
- **Blok UMKM** (`Umkm*`, kategori "UmkmPro") dipakai bersama editor + renderer + export. File berikut **harus byte-identik**: `components/umkm/{UmkmBlocks.tsx,UmkmCopyCode.tsx,umkm.css}` dan `lib/umkm.ts` di `apps/web` dan `apps/renderer`, plus `apps/api/internal/exports/umkm.css` (di-`go:embed`). Ubah satu → salin ke semua, cek dengan `diff`. Markup Go ada di `exports/render_umkm.go`; CSS hanya class `.wb-umkm-*` + theme vars (tanpa Tailwind) supaya port ke Go mekanis.

## Platform Articles (migration 0053)

Blog platform-level (bukan per-site) untuk SEO + edukasi UMKM. Terpisah dari blog per situs.

- Table `platform_articles` — slug unik, status (`draft|published`), category enum
  (`umum|tutorial|cerita|tips|panduan|pengumuman`), `featured` boolean, cover, body Markdown,
  SEO meta (title/description/keywords).
- Admin CRUD: `/admin/platform-articles` (list + filter) → `/new` + `/[id]/edit`
  pakai `<RichEditor>` TipTap full-page (bukan dialog) dengan autosave + dirty tracking.
- Public: `/artikel` (list + featured highlight 2-col + grid 3-col + category chips)
  + `/artikel/[slug]` (detail, auto `IncrementView`). Homepage card section via
  `<HomeArticlesSection />` di `apps/web/app/page.tsx`.
- **Markdown rendering CSS**: pakai class custom `.article-prose` (public, palette
  landing #172033/#d73f45) atau `.wb-prose` (editor, dark). JANGAN pakai `prose`
  Tailwind — `@tailwindcss/typography` tidak terinstall.
- Seed `platform_articles.SeedIfEmpty` — 6 artikel UMKM, hanya jalan kalau belum ada
  artikel published (DB lama tetap menyimpan artikel guru). Dipanggil goroutine di `main.go` dengan 30s timeout.

## Admin Impersonation Pattern (`GetOwnedOrAdmin`)

Admin role boleh masuk editor + manage konten situs user manapun untuk support/debug.
Jangan pakai `GetOwned(id, userID)` di handler yang perlu admin bypass — pakai
`GetOwnedOrAdmin(id, userID, isAdmin)` + `UpdateOrAdmin` (ada di `sites/repo.go`).

Helper: `auth.IsAdminFrom(c)` baca `role` claim JWT. Dipakai di handler:
`sites`, `pages`, `blog`, `products`,
`forms`, `analytics`, `usage`, `assets`.

**Kolaborator situs** (`site_members`, [sites/members.go](../apps/api/internal/sites/members.go)) —
jalur akses ketiga di samping owner dan admin. Role: `owner` (= `sites.user_id`),
`editor` (full edit + publish), `viewer` (read-only, untuk akses analytics saja).
Cek pakai `repo.HasAccess(ctx, siteID, userID, RoleOwner, RoleEditor)` → return role
atau `ErrNotFound`; jangan tulis query `site_members` sendiri di handler. UI di
tab **Anggota** situs (`apps/web/app/sites/[id]/members/`) + [settings/collaborators](../apps/web/app/settings/collaborators/).

**Bug yang pernah terjadi**: admin klik "Buka Editor" → redirect ke login. Root
cause: `sites.Get` masih pakai `GetOwned`. Ownership check di dashboard sudah ada,
tapi fetch pertama di editor fail. Fix: ganti ke `GetOwnedOrAdmin` di semua endpoint
yang editor panggil (Get/Update/Publish/ListMembers).

## Auth & Akun

Selain email+password (argon2id), surface auth lain yang sudah live — semua di
[internal/auth](../apps/api/internal/auth/), route di `MountUser`:

- **Google OAuth** ([google.go](../apps/api/internal/auth/google.go)) — `/auth/google/authorize` set
  state cookie http-only (CSRF + payload `next`) → consent → `/auth/google/callback` verify state,
  upsert user (link-by-email ATAU create), redirect ke `${WEB_BASE_URL}/auth/callback#access_token=…`.
  Token di **fragment**, bukan query, supaya tidak masuk log hop manapun. Jangan pindahkan ke query.
- **Verifikasi email** — `POST /auth/email/resend` + `/auth/email/verify`. Token opaque, disimpan
  sebagai hash (`HashOpaqueToken`), sekali pakai (`ConsumeEmailVerificationToken`). Kolom
  `users.email_verified_at`.
- **Reset password** — `/auth/password/forgot` + `/reset`, pola token sama (hash + consume).
- **Reseller apply** — `POST /auth/reseller/apply`, approval di `/admin/resellers`.
- **Invitation** — `/invitations/:token` + `/accept` ([invitation_repo.go](../apps/api/internal/auth/invitation_repo.go)),
  dipakai reseller untuk undang agent/client (`parent_reseller_id`).

## Background Workers

Semua dijalankan sebagai goroutine dari [cmd/server/main.go](../apps/api/cmd/server/main.go) dengan
`ctx` yang dibatalkan saat shutdown. Kalau menambah worker baru, ikuti pola yang sama
(`go w.Run(ctx)` + `select` on `ctx.Done()`), jangan blokir startup.

| Worker | Interval | Fungsi |
|--------|----------|--------|
| `pages.Scheduler` | 60s | Publish halaman dengan `scheduled_publish_at <= now`, lalu purge cache. Gagal = row tidak di-clear → retry tick berikutnya. |
| `notifier.Expiry` | 24h | Email peringatan domain expire ≤30 hari, dedup `expiry_notice_sent_at`, resend 7 hari. |
| `notifier.BYOReconciler` | 24h | Lifecycle domain BYO `.id` (drift 7d / disconnect 30d / cleanup 90d) + email. Aktif hanya kalau registrar client ada (butuh WHOIS). |
| `platform_articles.SeedIfEmpty` | sekali | Seed 6 artikel UMKM, timeout 30s, skip kalau sudah ada artikel published. |
| db pool snapshot | 5s | Gauge `db_pool_acquired/idle/total/max` ke `/metrics`. |

## Paket API yang Belum Disebut di Atas

- **[pricing](../apps/api/internal/pricing/)** — model harga 3 lapis: `platform_prices` (admin, per TLD:
  `retail_*` untuk client, `wholesale_*` untuk debit wallet reseller/agent) → `reseller_price_lists`
  (reseller set `agent_*` + `client_*`) → markup agent (free-form, TIDAK di-track sistem).
  Resolve lewat `GET /pricing/resolve/:tld`.
- **[zones](../apps/api/internal/zones/)** — katalog TLD authoritative (bukan EPP registry). Tiap zone punya
  rules dokumen + batas periode registrasi. `active=false` → zone tidak di-expose ke user meski EPP
  masih support. Harga direferensikan by convention (`platform_prices.tld`), bukan FK.
- **[payments](../apps/api/internal/payments/)** vs **[paymentgw](../apps/api/internal/paymentgw/)** — `payments`
  = CRUD `payment_methods` + validasi schema config JSONB per tipe gateway; `paymentgw` = factory +
  implementasi Gateway yang `GetByCode(ctx, "midtrans")` lalu instansiasi. Validasi config ada di
  `payments`, bukan di DB.
- **[forms](../apps/api/internal/forms/)** — definisi form + submission per situs. Renderer submit ke endpoint
  public → simpan `form_submissions` + notify owner via email.
- **[analytics](../apps/api/internal/analytics/)** — page-view counter, UPSERT increment ke daily bucket
  (row count tetap kecil). Belum ada unique visitor/referrer — kalau perlu, tambah tabel session baru,
  jangan ubah struktur ini.
- **[snippets](../apps/api/internal/snippets/)** — library blok reusable milik user (satu `BlockData` + nama),
  muncul sebagai tab tersendiri di palette dialog editor.

## Gotcha

- **Nama wilayah wajib ASCII** — [lib/wilayah.ts](../apps/web/lib/wilayah.ts) (38 provinsi + kota/kabupaten)
  sengaja tanpa aksen/em-dash supaya cocok langsung dengan EPP contact PostalInfo `type="int"`
  (RFC 5733 §2.6). Kalau menambah entri, pakai ASCII murni.
- **`NEXT_PUBLIC_*` butuh rebuild**, bukan cuma `pm2 restart` — nilainya di-inline saat `next build`.
- **Blok tipe tak dikenal** (mis. `Guru*` dari situs lama) wajib render kosong di editor + renderer +
  exporter, jangan throw.

## Don'ts

- ❌ Jangan tambah dependency tanpa cek dulu yang sudah ada di `go.mod` / `package.json`.
- ❌ Jangan ubah envelope response — klien (web/renderer) bergantung pada `{ data }` / `Paginated<T>`.
- ❌ Jangan interpolasi user input ke `ORDER BY` / `LIKE` tanpa whitelist / wildcard helper.
- ❌ Jangan hardcode brand color di renderer / exported CSS — pakai CSS variables.
- ❌ Jangan pakai emoji di code/file kecuali user minta. UI button emoji (📁, ↑, ↓, ⚙, ✕) OK karena sudah pola repo.
- ❌ Jangan tulis docstring panjang. Komentar maksimal 1-2 baris menjelaskan WHY.
- ❌ Jangan amend commit yang sudah ada — buat commit baru.
- ❌ Jangan auto-start dev server / docker compose tanpa user minta.

## Style Singkat

- File baru hanya jika benar-benar perlu. Prefer edit existing.
- Single responsibility per file (`storage_s3.go`, `storage_local.go` — bukan satu `storage.go` raksasa).
- Konsistensi naming: Go snake_case JSON tags, TS camelCase, slug huruf kecil + hyphen.
- Indonesian copy untuk user, English untuk dev tools (commit, log, comments).
