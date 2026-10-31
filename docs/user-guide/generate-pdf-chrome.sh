#!/bin/bash
# generate-pdf-chrome.sh — Generate PDF pakai Chrome/Chromium headless.
# TIDAK butuh pandoc/LaTeX install. Cuma butuh Chrome (Windows/macOS/Linux).
#
# Usage:
#   ./generate-pdf-chrome.sh              # semua role (gabungan)
#   ./generate-pdf-chrome.sh agent        # 1 role saja: client|agent|reseller|admin
#
# Auto-detect browser di:
#   macOS: /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
#          /Applications/Chromium.app/Contents/MacOS/Chromium
#          /Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge
#   Linux: google-chrome / chromium / chromium-browser
#   Windows: (bisa jalan via WSL atau Git Bash)

set -euo pipefail
cd "$(dirname "$0")"

ROLE="${1:-all}"
if [ "$ROLE" = "all" ]; then
  HTML="web-builder-guide.html"
  PDF="web-builder-guide.pdf"
else
  HTML="panduan-$ROLE.html"
  PDF="panduan-$ROLE.pdf"
fi

# ---------- Detect browser ----------
BROWSER=""
if [ -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]; then
  BROWSER="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
elif [ -x "/Applications/Chromium.app/Contents/MacOS/Chromium" ]; then
  BROWSER="/Applications/Chromium.app/Contents/MacOS/Chromium"
elif [ -x "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" ]; then
  BROWSER="/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
elif command -v google-chrome >/dev/null 2>&1; then
  BROWSER="google-chrome"
elif command -v chromium >/dev/null 2>&1; then
  BROWSER="chromium"
elif command -v chromium-browser >/dev/null 2>&1; then
  BROWSER="chromium-browser"
fi

if [ -z "$BROWSER" ]; then
  echo "❌ Chrome/Chromium/Edge tidak ditemukan"
  echo "   Install salah satu:"
  echo "     macOS:  brew install --cask google-chrome"
  echo "     Linux:  sudo apt install chromium-browser (Ubuntu)"
  echo "             sudo dnf install chromium (Fedora)"
  exit 1
fi

echo "→ Browser: $BROWSER"

# ---------- Regenerate HTML dulu ----------
NEEDS_REGEN=0
if [ ! -f "$HTML" ]; then
  NEEDS_REGEN=1
else
  for md in *.md; do
    [ "$md" -nt "$HTML" ] && NEEDS_REGEN=1 && break
  done
fi
if [ "$NEEDS_REGEN" = "1" ]; then
  echo "→ Regenerate HTML dari markdown..."
  # No head/tail here: it used to truncate the list of missing screenshots.
  ./generate-html.sh "$ROLE" 2>&1 | grep -v "WARNING"
fi

# ---------- Generate PDF ----------
echo "→ Convert HTML → PDF via Chrome headless..."

"$BROWSER" \
  --headless \
  --disable-gpu \
  --no-sandbox \
  --print-to-pdf="$PDF" \
  --print-to-pdf-no-header \
  "file://$(pwd)/$HTML" 2>&1 | grep -v "DevTools" | grep -v "^\[" || true

if [ -f "$PDF" ]; then
  echo ""
  echo "✓ Generated: $(pwd)/$PDF"
  echo "  Size: $(ls -lh "$PDF" | awk '{print $5}')"
  echo ""
  echo "→ Buka PDF:"
  echo "     open $PDF         (macOS)"
  echo "     xdg-open $PDF     (Linux)"
else
  echo "❌ PDF gagal di-generate"
  exit 1
fi
