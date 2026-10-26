#!/bin/bash
# generate-html.sh — Bikin HTML gabungan siap print-to-PDF di browser.
# Zero install kalau ada Python (macOS/Linux default punya).
#
# Usage:
#   ./generate-html.sh
#
# Output: web-builder-guide.html
# Cara pakai:
#   1. open web-builder-guide.html (macOS) atau xdg-open (Linux)
#   2. Browser buka, tekan Cmd/Ctrl+P
#   3. Destination: Save as PDF
#   4. Format: A4, margins: Default, background graphics: ON
#   5. Save

set -euo pipefail
cd "$(dirname "$0")"

# ---------- Ensure Python markdown ----------
if ! python3 -c "import markdown" 2>/dev/null; then
  echo "→ Install python markdown..."
  pip3 install markdown pygments 2>&1 | tail -2
fi

OUT="web-builder-guide.html"
echo "→ Generate $OUT..."

# ---------- HTML head + CSS ----------
cat > "$OUT" <<'HEAD_EOF'
<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="utf-8">
<title>Panduan Pengguna Web Builder</title>
<style>
  /* ==== Print-friendly stylesheet ==== */
  @page {
    size: A4;
    margin: 2cm 1.8cm;
  }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    line-height: 1.65;
    color: #1f2937;
    max-width: 780px;
    margin: 0 auto;
    padding: 2rem 1.5rem 4rem;
    font-size: 15px;
  }

  /* Cover */
  .cover {
    text-align: center;
    padding: 4rem 0;
    page-break-after: always;
  }
  .cover h1 {
    font-size: 2.5rem;
    margin: 0 0 0.5rem;
    color: #1e40af;
    border: none;
    padding: 0;
  }
  .cover p.subtitle { font-size: 1.15rem; color: #6b7280; margin: 0.5rem 0 2rem; }
  .cover .badge {
    display: inline-block;
    background: linear-gradient(135deg, #2563eb, #7c3aed);
    color: white;
    padding: 0.5rem 1.25rem;
    border-radius: 999px;
    font-size: 0.85rem;
    font-weight: 600;
    letter-spacing: 0.05em;
  }
  .cover .meta {
    margin-top: 3rem;
    font-size: 0.85rem;
    color: #9ca3af;
  }

  /* Headings — page break sebelum h1 (kecuali cover) */
  h1 {
    font-size: 1.8rem;
    color: #1e40af;
    border-bottom: 3px solid #2563eb;
    padding-bottom: 0.5rem;
    margin-top: 3rem;
    margin-bottom: 1.5rem;
    page-break-before: always;
  }
  h1:first-of-type { page-break-before: auto; }
  .cover + * h1 { page-break-before: auto; }

  h2 {
    color: #2563eb;
    font-size: 1.35rem;
    margin-top: 2.5rem;
    margin-bottom: 0.75rem;
    padding-bottom: 0.25rem;
    border-bottom: 1px solid #e5e7eb;
  }
  h3 {
    color: #374151;
    font-size: 1.1rem;
    margin-top: 1.75rem;
    margin-bottom: 0.5rem;
  }
  h4 { color: #4b5563; font-size: 1rem; margin: 1.25rem 0 0.5rem; }

  p { margin: 0.75rem 0; }

  /* Links */
  a { color: #2563eb; text-decoration: none; }
  a:hover { text-decoration: underline; }

  /* Inline code */
  code {
    background: #f3f4f6;
    padding: 2px 6px;
    border-radius: 4px;
    font-family: "SF Mono", Menlo, Monaco, Consolas, monospace;
    font-size: 0.88em;
    color: #be185d;
  }

  /* Code block */
  pre {
    background: #1e293b;
    color: #e2e8f0;
    padding: 1rem 1.25rem;
    border-radius: 8px;
    overflow-x: auto;
    line-height: 1.5;
    font-size: 0.85em;
    page-break-inside: avoid;
  }
  pre code {
    background: transparent;
    padding: 0;
    color: inherit;
    font-size: inherit;
  }

  /* Table */
  table {
    border-collapse: collapse;
    width: 100%;
    margin: 1rem 0;
    font-size: 0.92em;
    page-break-inside: avoid;
  }
  th, td {
    border: 1px solid #e5e7eb;
    padding: 8px 12px;
    text-align: left;
    vertical-align: top;
  }
  th {
    background: #f9fafb;
    font-weight: 600;
    color: #374151;
  }
  tbody tr:nth-child(even) { background: #fafafa; }

  /* Blockquote */
  blockquote {
    border-left: 4px solid #2563eb;
    background: #eff6ff;
    padding: 0.75rem 1rem;
    color: #1e3a8a;
    margin: 1rem 0;
    border-radius: 0 6px 6px 0;
  }
  blockquote p { margin: 0.25rem 0; }

  /* Lists */
  ul, ol { padding-left: 1.5rem; margin: 0.75rem 0; }
  li { margin: 0.25rem 0; }

  /* Callout-style paragraphs (starts dengan ⚠️ ✅ ❌ 💡) */
  p:has(+ *) strong:first-child { color: #dc2626; }

  /* Alert emoji styling via first-line pattern */
  li strong:first-child { color: #1e40af; }

  /* Placeholder buat screenshot user tambah sendiri */
  .screenshot-placeholder {
    border: 2px dashed #cbd5e1;
    background: #f8fafc;
    padding: 2rem;
    text-align: center;
    margin: 1rem 0;
    color: #64748b;
    font-style: italic;
    border-radius: 8px;
    page-break-inside: avoid;
  }
  .screenshot-placeholder::before {
    content: "🖼️ ";
    font-size: 2rem;
    display: block;
    margin-bottom: 0.5rem;
  }

  /* ASCII diagrams — render dengan font monospace + preserved whitespace */
  pre.ascii-diagram {
    background: #f8fafc;
    color: #334155;
    border: 1px solid #cbd5e1;
    font-size: 0.8em;
    line-height: 1.3;
  }

  /* Images (kalau user tambahin nanti) */
  img {
    max-width: 100%;
    height: auto;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    margin: 1rem 0;
    display: block;
  }

  /* TOC (Table of Contents) */
  .toc {
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    padding: 1.5rem 2rem;
    border-radius: 8px;
    page-break-after: always;
    margin-bottom: 3rem;
  }
  .toc h2 { margin-top: 0; border: none; padding: 0; color: #1e40af; }
  .toc ul { list-style: none; padding-left: 0; }
  .toc > ul > li { font-weight: 600; margin-top: 0.5rem; }
  .toc ul ul {
    padding-left: 1.5rem;
    font-weight: normal;
    font-size: 0.95em;
  }
  .toc a { color: #374151; }

  /* Section badge per bab */
  h1[id^="bab-"]::before {
    content: "";
    display: block;
    height: 4px;
    width: 60px;
    background: linear-gradient(90deg, #2563eb, #7c3aed);
    margin-bottom: 1rem;
    border-radius: 2px;
  }

  /* Print-specific */
  @media print {
    body { max-width: none; padding: 0; }
    a { color: #2563eb; text-decoration: none; }
    /* Show URL after link kalau external */
    a[href^="http"]::after {
      content: " (" attr(href) ")";
      font-size: 0.8em;
      color: #9ca3af;
      word-break: break-all;
    }
    /* Skip URL untuk anchor internal */
    a[href^="#"]::after,
    a[href^="/"]::after { content: ""; }

    pre, table, blockquote { page-break-inside: avoid; }
    h1, h2, h3 { page-break-after: avoid; }
    .no-print { display: none; }
  }
</style>
</head>
<body>

<!-- Cover Page -->
<div class="cover">
  <div class="badge">DOKUMENTASI PENGGUNA</div>
  <h1>Panduan Web Builder</h1>
  <p class="subtitle">Untuk Admin · Reseller · Agent · Client</p>
  <div class="meta">
    Web Builder Platform · Versi 1.0
  </div>
</div>

<!-- Content -->
HEAD_EOF

# ---------- Convert setiap markdown file ke HTML ----------
FILES=(
  "00-pengantar.md"
  "10-panduan-client.md"
  "20-panduan-agent.md"
  "30-panduan-reseller.md"
  "40-panduan-admin.md"
)

for f in "${FILES[@]}"; do
  echo "  · $f"
  python3 -m markdown -x fenced_code -x tables -x toc "$f" >> "$OUT"
done

# ---------- Footer ----------
cat >> "$OUT" <<'FOOT_EOF'

<footer style="margin-top: 4rem; padding-top: 2rem; border-top: 1px solid #e5e7eb; font-size: 0.85em; color: #9ca3af; text-align: center;">
  <p>Web Builder — Panduan Pengguna · Generated dari Markdown</p>
  <p>Untuk update terbaru, cek folder <code>docs/user-guide/</code> di repository</p>
</footer>

</body>
</html>
FOOT_EOF

echo ""
echo "✓ Generated: $(pwd)/$OUT"
echo "  Size: $(ls -lh $OUT | awk '{print $5}')"
echo ""
echo "→ Cara pakai:"
echo "  1. Buka di browser:"
echo "       open $OUT              (macOS)"
echo "       xdg-open $OUT          (Linux)"
echo "  2. Tekan Cmd/Ctrl + P (Print)"
echo "  3. Destination: Save as PDF"
echo "  4. Format: A4, margins Default, Background graphics ON"
echo "  5. Save"
