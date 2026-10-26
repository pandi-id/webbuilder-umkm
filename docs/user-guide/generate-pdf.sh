#!/bin/bash
# generate-pdf.sh — Generate PDF panduan Web Builder.
#
# Usage:
#   ./generate-pdf.sh            # Generate 1 PDF gabungan (all roles)
#   ./generate-pdf.sh split      # Generate 4 PDF terpisah per role
#   ./generate-pdf.sh check      # Check dependency, tidak generate
#
# Requirement: pandoc + xelatex (LaTeX)
#   macOS: brew install pandoc; brew install --cask basictex
#   Ubuntu: sudo apt install pandoc texlive-xetex
#
# Kalau tidak punya LaTeX, script auto-detect + swap ke wkhtmltopdf,
# hasilnya lebih basic tapi tetap PDF valid.

set -euo pipefail

cd "$(dirname "$0")"

MERGED_ORDER=(
  "00-pengantar.md"
  "10-panduan-client.md"
  "20-panduan-agent.md"
  "30-panduan-reseller.md"
  "40-panduan-admin.md"
)

# ---------- Detect PDF engine ----------
detect_engine() {
  if command -v xelatex >/dev/null 2>&1; then
    echo "xelatex"
  elif command -v wkhtmltopdf >/dev/null 2>&1; then
    echo "wkhtmltopdf"
  elif command -v pdflatex >/dev/null 2>&1; then
    echo "pdflatex"
  else
    echo ""
  fi
}

# ---------- Check dependencies ----------
check_deps() {
  local ok=1

  if ! command -v pandoc >/dev/null 2>&1; then
    echo "❌ pandoc tidak ter-install"
    echo "   Install: brew install pandoc   (macOS)"
    echo "            sudo apt install pandoc   (Ubuntu)"
    ok=0
  else
    echo "✓ pandoc: $(pandoc --version | head -1)"
  fi

  ENGINE=$(detect_engine)
  if [ -z "$ENGINE" ]; then
    echo "❌ Tidak ada PDF engine (xelatex/wkhtmltopdf/pdflatex)"
    echo "   Install salah satu:"
    echo "     brew install --cask basictex    (macOS, xelatex)"
    echo "     brew install wkhtmltopdf         (macOS, basic)"
    echo "     sudo apt install texlive-xetex   (Ubuntu)"
    ok=0
  else
    echo "✓ PDF engine: $ENGINE"
  fi

  if [ $ok -eq 0 ]; then
    exit 1
  fi
  return 0
}

# ---------- Generate merged PDF ----------
generate_merged() {
  local ENGINE
  ENGINE=$(detect_engine)

  echo "→ Generate PDF gabungan..."

  pandoc "${MERGED_ORDER[@]}" \
    --from markdown \
    --to pdf \
    --pdf-engine="$ENGINE" \
    --toc --toc-depth=2 \
    --number-sections \
    --variable=colorlinks:true \
    --variable=geometry:margin=2cm \
    --variable=documentclass:article \
    --metadata title="Panduan Pengguna Web Builder" \
    --metadata author="Web Builder Team" \
    --metadata date="$(date +%Y)" \
    -o web-builder-guide.pdf

  echo "✓ Generated: $(pwd)/web-builder-guide.pdf"
  ls -lh web-builder-guide.pdf
}

# ---------- Generate PDF per role ----------
generate_split() {
  local ENGINE
  ENGINE=$(detect_engine)

  echo "→ Generate 4 PDF terpisah per role..."

  # Client
  pandoc 00-pengantar.md 10-panduan-client.md \
    --toc --toc-depth=2 --pdf-engine="$ENGINE" \
    --variable=geometry:margin=2cm \
    --metadata title="Panduan Pengguna — Client" \
    -o pdf-client.pdf
  echo "  ✓ pdf-client.pdf"

  # Agent
  pandoc 00-pengantar.md 20-panduan-agent.md \
    --toc --toc-depth=2 --pdf-engine="$ENGINE" \
    --variable=geometry:margin=2cm \
    --metadata title="Panduan Pengguna — Agent" \
    -o pdf-agent.pdf
  echo "  ✓ pdf-agent.pdf"

  # Reseller
  pandoc 00-pengantar.md 30-panduan-reseller.md \
    --toc --toc-depth=2 --pdf-engine="$ENGINE" \
    --variable=geometry:margin=2cm \
    --metadata title="Panduan Pengguna — Reseller" \
    -o pdf-reseller.pdf
  echo "  ✓ pdf-reseller.pdf"

  # Admin
  pandoc 00-pengantar.md 40-panduan-admin.md \
    --toc --toc-depth=2 --pdf-engine="$ENGINE" \
    --variable=geometry:margin=2cm \
    --metadata title="Panduan Pengguna — Admin" \
    -o pdf-admin.pdf
  echo "  ✓ pdf-admin.pdf"

  echo ""
  echo "Semua PDF di: $(pwd)/"
  ls -lh pdf-*.pdf
}

# ---------- Main ----------
case "${1:-merged}" in
  check)
    check_deps
    ;;
  split)
    check_deps
    generate_split
    ;;
  merged|"")
    check_deps
    generate_merged
    ;;
  *)
    echo "Usage: $0 [merged|split|check]"
    echo "  merged  — 1 PDF gabungan (default)"
    echo "  split   — 4 PDF terpisah per role"
    echo "  check   — cek dependency saja, tidak generate"
    exit 1
    ;;
esac
