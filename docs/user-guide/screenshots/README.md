# Folder Screenshot

> ⚠️ **PENTING: Screenshot Q1 2026 belum di-capture** untuk fitur editor
> baru (Layout Bersama, micro-editing, Rich Editor delete UX, autosave
> badge, drag-drop image). Screenshot editor lama (`client-editor-*.png`
> dated Aug/Sep 2025) **sudah tidak sesuai** dengan UI
> sekarang — banyak perubahan visual di sidebar, canvas, dan toolbar.
>
> **Cara regenerate**:
> ```bash
> cd docs/user-guide/capture-screenshots
> node capture.mjs client   # capture semua client + editor screenshots
> ```
> Butuh minimal 1 site dengan beberapa produk + artikel. Isi `SAMPLE_SITE_ID` di `.env` untuk pin ke
> site tertentu, atau biarkan auto-discover dari list.

Drop file gambar di sini dengan nama sesuai referensi di markdown:

### Client — Alur dasar
- `client-daftar.png` — Halaman register (form daftar akun baru)
- `client-login.png` — Halaman login
- `client-dashboard.png` — Dashboard user biasa
- `client-wizard-search.png` — Wizard search domain
- `client-wizard-confirm.png` — Konfirmasi pembelian + form kontak + kode promo
- `client-pending-status.png` — Halaman polling status pembelian
- `client-template-picker.png` — Pilih template setelah domain aktif
- `client-domain-detail.png` — Halaman kelola 1 domain

### Client — Editor blok (fitur baru Q1 2026)
- `client-editor-overview.png` — Layout editor (3 kolom)
- `client-editor-layout-mode.png` — Mode edit Layout Bersama (header/footer)
- `client-editor-layout-toggle.png` — Toggle aktif/nonaktif header/footer
- `client-editor-micro-edit.png` — Inline micro-edit di canvas
- `client-editor-readonly-strip.png` — Preview read-only header/footer di page mode
- `client-editor-drag-ghost.png` — DragOverlay ghost badge saat drag blok
- `client-editor-block-add.png` — Cara add block baru (dialog palette)
- `client-editor-layout-panel.png` — Panel Layout & Style
- `client-theme-page.png` — Halaman tema (color + font picker)

### Client — Rich Editor (fitur baru Q1 2026)
- `client-richeditor-toolbar.png` — Toolbar Rich Editor lengkap
- `client-richeditor-drop-image.png` — Drag-drop image ke editor body
- `client-richeditor-youtube-selected.png` — YouTube node selected dengan tombol ×
- `client-richeditor-autosave-badge.png` — Badge "Tersimpan · baru saja"
- `client-tulisan-unsaved-badge.png` — Badge amber "Belum disimpan"

- `agent-dashboard.png` — Dashboard agent
- `agent-clients-list.png` — List klien yang di-assign
- `agent-buy-domain-obo.png` — Wizard beli domain "untuk klien"

- `reseller-dashboard.png` — Dashboard reseller (4 tile + checklist)
- `reseller-clients.png` — List klien + tab agent
- `reseller-invite-agent.png` — Dialog invite agent
- `reseller-wallet.png` — Wallet + top-up flow
- `reseller-pricing.png` — Set harga jual per TLD

- `admin-stats.png` — Overview stats admin
- `admin-users.png` — Manage users
- `admin-resellers-pending.png` — Approve reseller aplication
- `admin-invoices.png` — Verify manual bank transfer
- `admin-cf-configs.png` — Cloudflare config CRUD
- `admin-domain-detail.png` — Detail domain admin (dengan CF status)
- `admin-audit-log.png` — Audit log viewer

### macOS
- **Full window**: `Cmd + Shift + 4`, lalu tekan `Space`, klik window
- **Selection area**: `Cmd + Shift + 4`, drag area
- **Full screen**: `Cmd + Shift + 3`

Screenshot otomatis save ke Desktop (default). Pindah ke folder ini.

### Windows
- **Snipping Tool**: `Win + Shift + S` → drag area
- **Full screen**: `PrtScn`, paste di aplikasi image
- **Window**: `Alt + PrtScn`, paste

### Linux (GNOME)
- **Selection**: `Shift + PrtScn`
- **Full screen**: `PrtScn`

## Optimize File

Sebelum commit, resize + optimize:

```bash
# macOS (butuh install imagemagick: brew install imagemagick)
cd screenshots
for f in *.png; do
  convert "$f" -resize '1200>' -quality 85 "$f"
done

# Atau pakai tool online: tinypng.com
```

Target ukuran:
- < 200 KB per gambar
- Width max 1200px (readable di PDF A4)
- Format PNG (lossless untuk UI screenshot)

## Referensi di Markdown

Setelah upload, ganti placeholder di markdown:

**Sebelum** (placeholder):
```markdown
<!-- [screenshot: client-dashboard.png caption:Dashboard User] -->
```

**Sesudah** (real image):
```markdown
![Dashboard User](screenshots/client-dashboard.png)
```

Regenerate HTML: `./generate-html.sh` — gambar otomatis embed.
