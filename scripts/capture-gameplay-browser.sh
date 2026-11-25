#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/reference/messenger.abeto.co/network-urls-gameplay.txt"
AB="mise exec aqua:vercel-labs/agent-browser -- agent-browser"

mkdir -p "$(dirname "$OUT")"

$AB open https://messenger.abeto.co/
$AB wait 8000
$AB network requests --clear >/dev/null

$AB eval 'window.__webgl?.start?.()'
$AB wait 5000

for x in 640 480 320; do
  $AB mouse move "$x" 420
  $AB mouse down
  $AB mouse up
  $AB wait 1500
done

$AB wait 10000
$AB network requests 2>&1 | rg -o 'https://messenger\.abeto\.co[^ ]+' | sort -u >"$OUT"

python3 "$ROOT/scripts/discover-assets.py"
bash "$ROOT/scripts/download-reference.sh"
$AB close

echo "Gameplay capture URLs: $(wc -l <"$OUT")"
