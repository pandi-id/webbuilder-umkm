# Panduan Pengguna Web Builder

Dokumentasi lengkap penggunaan Web Builder untuk 4 role: Admin, Reseller,
Agent, Client.

## Output Files (siap pakai)

**Bundle internal (4 role — untuk tim)**:
- **[web-builder-guide.pdf](web-builder-guide.pdf)** — PDF gabungan semua bab (client + agent + reseller + admin)
- **[web-builder-guide.html](web-builder-guide.html)** — HTML self-contained

Untuk bundle internal 4-role: `./generate-pdf-chrome.sh` (regenerate `web-builder-guide.pdf`).

## Struktur Markdown Source

- **[00-pengantar.md](00-pengantar.md)** — Overview aplikasi, terminology, konsep role
- **[10-panduan-client.md](10-panduan-client.md)** — Pengguna umum (buat situs sendiri)
- **[20-panduan-agent.md](20-panduan-agent.md)** — Freelancer/staff reseller
- **[30-panduan-reseller.md](30-panduan-reseller.md)** — Mitra bisnis (invite agent, set harga)
- **[40-panduan-admin.md](40-panduan-admin.md)** — Operator platform

## Screenshot

Placeholder `![Caption](screenshots/xxx.png)` sudah ditaruh di key sections
(dashboard, wizard, editor, dsb.). Capture screenshot sendiri lalu drop ke
folder `screenshots/` — nama file sudah didefinisikan.

Lihat [screenshots/README.md](screenshots/README.md) untuk:
- Daftar 24 nama file yang direferensi
- Cara capture di macOS/Windows/Linux
- Cara optimize (resize + compress)

Tanpa screenshot, HTML/PDF tetap generate — placeholder muncul sebagai broken
image icon (harmless, cuma kurang cantik).

## Cara Generate PDF (3 opsi)

### Opsi 1 — Chrome headless (paling cepat, no install)

Butuh Chrome/Chromium/Edge (yang paling umum sudah ter-install).

```bash
cd docs/user-guide
./generate-pdf-chrome.sh
```

Auto: baca markdown → generate HTML → convert PDF via Chrome headless.
Output: `web-builder-guide.pdf`.

### Opsi 2 — Manual print dari HTML

```bash
cd docs/user-guide
./generate-html.sh          # generate HTML dari markdown
open web-builder-guide.html # buka di browser (macOS)
```

Di browser: **Cmd/Ctrl+P** → Save as PDF → Format A4 → **Background graphics: ON**

### Opsi 3 — Pandoc (kalau butuh LaTeX-quality)

Ada 3 pilihan tergantung tool yang tersedia:

### Opsi A — Pandoc (recommended, hasil paling clean)

Install pandoc + LaTeX engine (xelatex atau wkhtmltopdf):

```bash
# macOS
brew install pandoc
brew install --cask basictex   # atau brew install wkhtmltopdf

# Ubuntu
sudo apt install pandoc texlive-xetex   # atau wkhtmltopdf

# Verify
pandoc --version
```

Generate PDF single-file dari semua bab:

```bash
cd docs/user-guide

pandoc \
  00-pengantar.md \
  10-panduan-client.md \
  20-panduan-agent.md \
  30-panduan-reseller.md \
  40-panduan-admin.md \
  --from markdown \
  --to pdf \
  --pdf-engine=xelatex \
  --toc \
  --toc-depth=2 \
  --number-sections \
  --variable=colorlinks:true \
  --variable=geometry:margin=2cm \
  --variable=documentclass:article \
  --metadata title="Panduan Pengguna Web Builder" \
  --metadata author="Web Builder Team" \
  --metadata date="2026" \
  -o web-builder-guide.pdf
```

Kalau tidak punya LaTeX, pakai wkhtmltopdf:

```bash
pandoc \
  00-pengantar.md 10-panduan-client.md 20-panduan-agent.md 30-panduan-reseller.md 40-panduan-admin.md \
  --toc --toc-depth=2 --number-sections \
  --metadata title="Panduan Pengguna Web Builder" \
  -o web-builder-guide.pdf
```

### Opsi B — Chrome Print-to-PDF (tanpa install)

1. Concat semua bab jadi 1 HTML:

```bash
cd docs/user-guide

# Install md-to-html converter (Python markdown, atau nodejs marked)
pip install markdown pygments   # macOS/Linux
# atau: npm install -g marked

# Concat + convert
cat 00-pengantar.md 10-panduan-client.md 20-panduan-agent.md 30-panduan-reseller.md 40-panduan-admin.md \
  | python3 -m markdown -x fenced_code -x codehilite -x tables \
  > /tmp/web-builder-guide.html

# Wrap dengan styling minimal
cat > /tmp/web-builder-guide-styled.html <<'STYLE_EOF'
<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="utf-8">
<title>Panduan Web Builder</title>
<style>
  body { font-family: -apple-system, sans-serif; max-width: 780px; margin: 2rem auto; padding: 0 1.5rem; line-height: 1.6; }
  h1 { border-bottom: 2px solid #333; padding-bottom: .5rem; page-break-before: always; }
  h1:first-child { page-break-before: auto; }
  h2 { color: #2563eb; margin-top: 2rem; }
  code { background: #f5f5f5; padding: 2px 6px; border-radius: 3px; font-size: 0.9em; }
  pre { background: #1e293b; color: #f1f5f9; padding: 1rem; border-radius: 6px; overflow-x: auto; }
  pre code { background: none; color: inherit; padding: 0; }
  table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
  th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
  th { background: #f5f5f5; }
  blockquote { border-left: 4px solid #2563eb; padding-left: 1rem; color: #555; }
</style>
</head>
<body>
STYLE_EOF
cat /tmp/web-builder-guide.html >> /tmp/web-builder-guide-styled.html
echo '</body></html>' >> /tmp/web-builder-guide-styled.html

# Buka di browser
open /tmp/web-builder-guide-styled.html      # macOS
# xdg-open /tmp/web-builder-guide-styled.html # Linux
```

2. Di browser: **File → Print → Save as PDF**

### Opsi C — md-to-pdf CLI (paling cepat)

```bash
npm install -g md-to-pdf

cd docs/user-guide
cat 00-pengantar.md 10-panduan-client.md 20-panduan-agent.md 30-panduan-reseller.md 40-panduan-admin.md \
  | md-to-pdf --stylesheet-encoding utf-8 > web-builder-guide.pdf
```

### Opsi D — VSCode + Extension

1. Install extension **"Markdown PDF"** (yzane.markdown-pdf) di VSCode
2. Buka file `.md` → **Ctrl+Shift+P** → `Markdown PDF: Export (pdf)`
3. Repeat per file, atau install extension "Merge PDF" untuk gabung

## Generate PDF per Role Terpisah

Kalau butuh PDF per role (untuk share ke masing-masing user):

```bash
cd docs/user-guide

# PDF untuk Client (pengantar + client guide)
pandoc 00-pengantar.md 10-panduan-client.md \
  --toc --toc-depth=2 --pdf-engine=xelatex \
  --metadata title="Panduan Pengguna — Client" \
  -o pdf-client.pdf

# PDF untuk Agent
pandoc 00-pengantar.md 20-panduan-agent.md \
  --toc --pdf-engine=xelatex \
  --metadata title="Panduan Pengguna — Agent" \
  -o pdf-agent.pdf

# PDF untuk Reseller
pandoc 00-pengantar.md 30-panduan-reseller.md \
  --toc --pdf-engine=xelatex \
  --metadata title="Panduan Pengguna — Reseller" \
  -o pdf-reseller.pdf

# PDF untuk Admin
pandoc 00-pengantar.md 40-panduan-admin.md \
  --toc --pdf-engine=xelatex \
  --metadata title="Panduan Pengguna — Admin" \
  -o pdf-admin.pdf
```

## Update Panduan

Panduan berbentuk Markdown supaya mudah maintain:
- Version control via Git
- Update per fitur baru (append ke section terkait)
- Diff yang jelas per commit
- Regenerate PDF setelah update

Setelah edit `.md`, jalankan lagi command PDF generation untuk publish versi baru.

## Convention

- Bahasa: Indonesia untuk user-facing content
- Kode + command tetap English (untuk copy-paste)
- Path file relative dari root project
- Screenshot: tidak di-include (skip biar file kecil). Alternatif: link ke video walkthrough
