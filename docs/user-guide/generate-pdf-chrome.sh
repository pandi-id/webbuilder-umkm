#!/bin/bash
# generate-pdf-chrome.sh — Generate PDF pakai Chrome/Chromium headless.
# TIDAK butuh pandoc/LaTeX install. Cuma butuh Chrome (Windows/macOS/Linux).
#
# Usage:
#   ./generate-pdf-chrome.sh
#
# Auto-detect browser di:
#   macOS: /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
#          /Applications/Chromium.app/Contents/MacOS/Chromium
#          /Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge
#   Linux: google-chrome / chromium / chromium-browser
#   Windows: (bisa jalan via WSL atau Git Bash)

set -euo pipefail
cd "$(dirname "$0")"

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
if [ ! -f web-builder-guide.html ] || \
   [ 00-pengantar.md -nt web-builder-guide.html ] || \
   [ 10-panduan-client.md -nt web-builder-guide.html ] || \
   [ 20-panduan-agent.md -nt web-builder-guide.html ] || \
   [ 30-panduan-reseller.md -nt web-builder-guide.html ] || \
   [ 40-panduan-admin.md -nt web-builder-guide.html ]; then
  echo "→ Regenerate HTML dari markdown..."
  ./generate-html.sh 2>&1 | grep -v "WARNING" | head -10
fi

# ---------- Generate PDF ----------
echo "→ Convert HTML → PDF via Chrome headless..."

"$BROWSER" \
  --headless \
  --disable-gpu \
  --no-sandbox \
  --print-to-pdf=web-builder-guide.pdf \
  --print-to-pdf-no-header \
  "file://$(pwd)/web-builder-guide.html" 2>&1 | grep -v "DevTools" | grep -v "^\[" || true

if [ -f web-builder-guide.pdf ]; then
  echo ""
  echo "✓ Generated: $(pwd)/web-builder-guide.pdf"
  echo "  Size: $(ls -lh web-builder-guide.pdf | awk '{print $5}')"
  echo ""
  echo "→ Buka PDF:"
  echo "     open web-builder-guide.pdf         (macOS)"
  echo "     xdg-open web-builder-guide.pdf     (Linux)"
else
  echo "❌ PDF gagal di-generate"
  exit 1
fi
