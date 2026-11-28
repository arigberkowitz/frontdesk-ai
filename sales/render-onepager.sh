#!/usr/bin/env bash
# Render sales/onepager.html to sales/frontdesk-ai-onepager.pdf (letter, one page).
set -euo pipefail
cd "$(dirname "$0")/.."
chrome="${CHROME:-google-chrome}"
out="sales/frontdesk-ai-onepager.pdf"
"$chrome" --headless=new --disable-gpu --no-pdf-header-footer \
  --print-to-pdf="$out" "file://$(pwd)/sales/onepager.html"
echo "Wrote $out"
