# Login & Daftar dengan e.id (OAuth SSO) — Kajian

Sumber: <https://docs.e.id/en/oauth-sso> (API v1.1), dibaca 10 Nov 2026.
Status: **sudah diterapkan** (login + daftar dengan e.id), menunggu kredensial
sandbox/production dari e.id. Keputusan produk (10 Nov 2026):

- Poin 1 dan 2 di §3 (`state`, ID permanen) adalah urusan e.id — kita cukup
  menyediakan fitur login; akun dicocokkan lewat email.
- Semua tier boleh login ("kalau bisa login ke e.id, bisa login di sini").
  Tier 0 hanya tidak menandai email sebagai terverifikasi.
- NIK tidak diambil dari e.id; kalau kosong, alur beli domain tetap memintanya.

Cara mengaktifkan: isi `EID_OAUTH_CLIENT_ID`, `EID_OAUTH_CLIENT_SECRET`, dan
`EID_API_BASE` di `.env` API, restart, lalu daftarkan callback URL yang tercetak
di log `eid oauth: enabled` ke dashboard e.id. Tombol muncul otomatis (web membaca
`GET /api/v1/auth/providers`).

Catatan implementasi di repo ini (`apps/api/internal/auth/eid.go` + `eid_repo.go`,
port dari repo `website` commit d1148d2, dengan tambahan di bawah):

- **Pre-account takeover ditutup.** Karena tier 0 boleh daftar, penyerang bisa
  membuat akun di sini memakai email korban lewat e.id tier 0. Kalau korban lalu
  mengambil alih akun itu lewat reset password, identitas e.id tier 0 milik
  penyerang **ditolak** (`eid_email_unverified`) — identitas tier 0 hanya bisa
  masuk ke akun yang tidak punya cara login lain. Tier ≥ 1 tetap lancar.
- **Tier 0 tidak ditautkan ke akun lama** berdasarkan email (repo `website` masih
  menautkannya — siapa pun yang memasang email korban di e.id tanpa verifikasi
  bisa masuk ke akun korban).
- Cek "sudah punya cara login" (`auth.HasLoginExpr`) kini ikut menghitung
  `user_identities`; tanpa itu akun e.id-only terbaca "belum punya login"
  (daftar klien reseller bahkan gagal scan karena ekspresinya NULL).
- `state` tetap tidak ada; cookie alur http-only wajib ada saat callback. Ini
  menahan tautan callback berisi `code` milik orang lain, tapi bukan halaman yang
  lebih dulu membuka `/authorize` di browser korban — butuh dukungan `state` dari e.id.
- Sandbox: dokumentasi menyebut `https://api-dev.e.id`, Postman resmi memakai
  `https://gateway-sandbox.e.id` — pakai yang tertera di dashboard developer.
- Tombol memakai ikon generik sampai e.id merilis pedoman logo.

## 1. Ringkasan e.id SSO

e.id adalah dompet identitas digital (verifiable credentials). Salah satu
layanannya adalah **OAuth SSO**: pengguna masuk memakai akun e.id, aplikasi kita
menerima token untuk membaca profilnya. Polanya *authorization code* seperti
Google, tapi **bukan OpenID Connect** — tidak ada `id_token`, discovery
(`.well-known`), JWKS, maupun `sub`.

| Lingkungan | Base URL API |
|---|---|
| Sandbox | `https://api-dev.e.id` |
| Production | `https://api-wallet.e.id` |

Semua respons memakai envelope `{ "status": bool, "message": string, "data": … }`;
kode error ada di `message` (mis. `OAUTH.CLIENT_NOT_FOUND`).

### Alur resmi (5 langkah)

```
Browser                    API kita                         e.id
   │ klik "Masuk dengan e.id"  │                               │
   │──────────────────────────▶│ GET /auth/eid/authorize       │
   │◀──── 302 ─────────────────│ (set cookie state)            │
   │── GET /api/v1.1/oauth/verify?client_id=…&callback_url=… ─▶│ (2) validasi client
   │◀─────────────────── 302 ke halaman login/consent e.id ────│
   │      (pengguna login + setuju)                            │
   │◀──── 302 ke callback_url?code=XXXX ───────────────────────│ (3) code sekali pakai
   │──────────────────────────▶│ GET /auth/eid/callback?code=  │
   │                           │── POST /oauth/get-token ─────▶│ (4) code → token
   │                           │── GET /oauth/get-profile ────▶│ (5) token → profil
   │                           │ upsert user, terbitkan JWT kita│
   │◀── 302 /auth/callback#access_token=…&refresh_token=… ─────│
```

Langkah (1) *Get App Name* hanya mengambil nama/ikon aplikasi untuk tombol —
tidak wajib bagi kita, tapi berguna sebagai **health check konfigurasi** (404
`OAUTH.CLIENT_NOT_FOUND` = client_id/callback_url belum terdaftar).

### Endpoint

| # | Endpoint | Dipanggil oleh | Catatan |
|---|---|---|---|
| 1 | `GET /api/v1.1/oauth/client/{client_id}/{callback_url}` | backend (opsional) | → `app_name`, `icon_url`, `callback_url`, `scopes` |
| 2 | `GET /api/v1.1/oauth/verify?client_id=&callback_url=` | **browser** (redirect) | 302 ke login e.id, atau ke halaman unauthorized-client |
| 3 | `POST /api/v1.1/oauth/get-token` (JSON) | **backend** | body: `client_id`, `client_secret`, `code`, `redirect_uri` → `data.token`, `data.token_type: "Bearer"`, `data.expired_date` (ISO 8601) |
| 4 | `GET /api/v1.1/oauth/get-profile?scope=email:profile` | **backend**, `Authorization: Bearer <token>` | default scope `profile` **tanpa email** — wajib minta `email:profile` |

Error yang terdokumentasi: `400 OAUTH.INVALID_OR_EXPIRED_CODE` (code dipakai
ulang/kedaluwarsa), `401 OAUTH.INVALID_CLIENT_CREDENTIALS`, `401 UNAUTHORIZATION`
(token salah), `404 OAUTH.CLIENT_NOT_FOUND`.

### Data profil yang didapat

```json
{
  "email": "string",
  "profile": {
    "fullname": "string", "phonenumber": "string", "countryphonecode": "62",
    "address": "string", "avatar": "url", "tier": 2
  }
}
```

`tier`: **0** belum terverifikasi · **1** email/HP terverifikasi · **2** email,
HP, dan identitas resmi (KTP) terverifikasi.

### Cara mendaftar sebagai developer

1. Buat akun e.id → 2. ajukan developer lewat *Settings* → 3. buat OAuth app di
developer dashboard (daftarkan callback URL) → 4. terima `client_id` +
`client_secret`. Ada Postman collection resmi (`eid-oauth-sso.postman_collection.json`).

## 2. Perbedaan dengan Google (yang sudah kita punya)

| Aspek | Google (sekarang) | e.id |
|---|---|---|
| Protokol | OIDC lewat `golang.org/x/oauth2` | OAuth custom, envelope sendiri → **HTTP client manual** |
| ID pengguna stabil | `sub` | **tidak ada** — hanya email |
| `state` (anti-CSRF) | ada, dicek di callback | **tidak terdokumentasi** |
| Status email | `email_verified` | `tier` ≥ 1 |
| Data tambahan | nama | nama, HP, alamat, avatar, tingkat verifikasi KTP |
| Refresh token | tidak dipakai | tidak ada (token pendek, cukup sekali pakai) |

## 3. Celah yang harus dijawab sebelum implementasi

Ini bukan sekadar catatan — tiga poin pertama menentukan aman tidaknya fitur ini.

1. **Tidak ada `state`.** Tanpa `state`, callback rentan *login CSRF*
   (penyerang membuat browser korban login ke akun milik penyerang). Uji di
   sandbox apakah e.id meneruskan `state` (atau parameter tambahan di
   `callback_url`) apa adanya. Kalau tidak, minimal pakai cookie nonce
   http-only yang diset saat authorize dan wajib ada saat callback — itu hanya
   mitigasi sebagian.
2. **Tidak ada ID pengguna yang stabil.** Kalau akun dicocokkan lewat email
   saja, pengguna yang mengganti email di e.id akan mendapat akun baru di kita,
   dan siapa pun yang bisa memasang email orang lain di e.id dapat mengambil
   alih akun. Minta ke e.id field ID permanen (mis. `user_id`/`sub`).
3. **Email belum tentu terverifikasi.** Tier 0 = belum diverifikasi. Tolak login
   kalau `tier < 1`, dan **jangan** auto-link ke akun lama berdasarkan email
   kecuali tier ≥ 1.
4. Tidak dijelaskan: apa yang dikirim ke callback saat pengguna menolak
   consent, masa berlaku `code`, aturan pencocokan `callback_url` (persis atau
   prefix), rate limit, dan pedoman branding tombol/logo e.id.
5. NIK **tidak** dikembalikan walaupun tier 2. Form beli domain `.id` tetap
   harus meminta NIK.

### Pertanyaan untuk tim e.id

- Apakah ada ID pengguna permanen di `get-profile`? Kalau belum, bisakah ditambahkan?
- Apakah parameter `state` didukung / diteruskan ke callback?
- Apa respons ke callback saat pengguna menolak (`?error=`?), dan berapa lama `code` berlaku?
- Apakah `callback_url` dicocokkan persis? Boleh lebih dari satu (sandbox, staging, prod)?
- Bisakah aplikasi mewajibkan tier minimum? Bisakah NIK (tier 2) dibagikan dengan consent?
- Ada pedoman tombol "Masuk dengan e.id" (logo, warna, teks)?

## 4. Rancangan implementasi (mengikuti pola Google)

Satu endpoint menangani **login dan daftar sekaligus**, sama seperti Google:
kalau akun belum ada, dibuat otomatis.

### Backend (`apps/api`)

- **`internal/auth/eid.go`** — `EIDHandler` dengan `Authorize` dan `Callback`,
  meniru [google.go](apps/api/internal/auth/google.go): cookie state http-only
  10 menit, `sanitizeNextPath`, redirect error ke `/login?error=eid_*`, token
  dikirim lewat fragment `#access_token=…` ke `/auth/callback` (halaman web yang
  sama dengan Google, tidak perlu halaman baru).
- **Klien e.id** (HTTP manual, timeout 10 detik): `getToken(code)` dan
  `getProfile(token)`; parse envelope, petakan `message` ke error.
- **Callback**:
  1. `code` kosong → `eid_cancelled`.
  2. Tukar code → token → profil (`scope=email:profile`).
  3. Tolak bila email kosong (`eid_no_email`) atau `tier < 1` (`eid_unverified`).
  4. Upsert user → `MintTokensFor` → redirect ke web.
- **Upsert** (`UpsertEIDUser`): cari identitas e.id → kalau tidak ada, link ke
  user dengan email sama (hanya tier ≥ 1) → kalau tidak ada, buat user baru
  (`password_hash NULL`, `email_verified_at = now()`). Isi `phone_number` dan
  `address` dari e.id **hanya kalau kolomnya masih kosong**, supaya data yang
  sudah diisi pengguna tidak tertimpa. Simpan `tier`.
- **Route** di [user.go](apps/api/internal/router/user.go):
  `GET /api/v1/auth/eid/authorize` (rate limit seperti Google) dan
  `GET /api/v1/auth/eid/callback`. Kalau belum dikonfigurasi → 503
  `eid_not_configured` supaya tombol bisa disembunyikan.

### Database (migration baru)

Daripada menambah kolom per provider (`oauth_google_sub`, lalu `oauth_eid_…`),
lebih rapi tabel identitas umum:

```sql
CREATE TABLE IF NOT EXISTS user_identities (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider   TEXT NOT NULL,          -- 'eid' (nanti bisa 'google')
    subject    TEXT NOT NULL,          -- ID permanen e.id; sementara email
    email      TEXT NOT NULL DEFAULT '',
    tier       INT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (provider, subject)
);
```

Kalau e.id belum menyediakan ID permanen, `subject` diisi email — dan cukup
diganti ke ID permanen begitu tersedia, tanpa mengubah skema.

### Konfigurasi

| Env | Isi |
|---|---|
| `EID_OAUTH_CLIENT_ID` | dari developer dashboard e.id |
| `EID_OAUTH_CLIENT_SECRET` | rahasia — hanya di server |
| `EID_API_BASE` | default `https://api-wallet.e.id`; dev: `https://api-dev.e.id` |

Callback URL tidak perlu env baru: turunkan dari `PUBLIC_API_HOST` yang sudah
ada → `https://<PUBLIC_API_HOST>/api/v1/auth/eid/callback`. URL inilah yang
didaftarkan di dashboard e.id. Env baru didaftarkan di `config.go`,
`apps/api/.env.example`, `infra/docker-compose.yml`, dan `infra/.env.example`.

### Frontend (`apps/web`)

- `components/EidButton.tsx` — sama seperti
  [GoogleButton.tsx](apps/web/components/GoogleButton.tsx), redirect ke
  `/api/v1/auth/eid/authorize?next=…`, label "Masuk dengan e.id" /
  "Daftar dengan e.id", logo sesuai pedoman e.id.
- Pasang di [login](apps/web/app/(auth)/login/page.tsx) dan
  [register](apps/web/app/(auth)/register/page.tsx) di bawah tombol Google.
- Tambah pesan error di peta error halaman login:
  `eid_cancelled` "Anda membatalkan login di e.id.", `eid_unverified` "Akun e.id
  Anda belum terverifikasi. Verifikasi email/HP di aplikasi e.id terlebih
  dulu.", `eid_no_email`, `eid_exchange_failed`, `eid_not_configured`.
- `/auth/callback` tidak berubah.

### Nilai tambah khusus e.id

- **Isi otomatis profil kontak** (nama, HP, alamat) yang wajib untuk beli
  domain — mengurangi isian di wizard.
- **Tier 2 = KTP sudah diverifikasi e.id.** Bisa ditampilkan sebagai badge
  "Identitas terverifikasi", dan berpotensi mempercepat verifikasi dokumen
  `.id` — tapi tetap perlu NIK sampai e.id membagikannya.

## 5. Langkah berikutnya

1. Daftar developer + buat OAuth app **sandbox**; daftarkan callback lokal/staging.
2. Uji manual dengan Postman collection: perilaku `state`, respons saat menolak
   consent, isi profil per tier.
3. Kirim daftar pertanyaan di §3 ke tim e.id.
4. Implementasi sesuai §4 setelah poin `state` dan ID permanen jelas.
