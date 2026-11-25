#!/usr/bin/env bash
set -euo pipefail

BASE_URL="https://messenger.abeto.co"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/reference/messenger.abeto.co"
URLS_FILE="$ROOT/network-urls.txt"
MANIFEST="$ROOT/manifest.txt"
PARALLEL="${PARALLEL:-8}"

mkdir -p "$ROOT"

download_one() {
  local url="$1"
  local rel dest

  if [[ "$url" == "$BASE_URL" || "$url" == "$BASE_URL/" ]]; then
    dest="$ROOT/index.html"
  else
    rel="${url#"$BASE_URL"/}"
    dest="$ROOT/$rel"
  fi

  mkdir -p "$(dirname "$dest")"
  if [[ -f "$dest" && -s "$dest" ]]; then
    return 0
  fi

  if ! curl -fsSL --retry 3 --retry-delay 1 "$url" -o "$dest.tmp"; then
    echo "FAILED: $url" >&2
    rm -f "$dest.tmp"
    return 1
  fi
  mv "$dest.tmp" "$dest"
}

export -f download_one
export BASE_URL ROOT

if [[ ! -f "$URLS_FILE" ]]; then
  echo "Missing $URLS_FILE" >&2
  exit 1
fi

grep -v '^#' "$URLS_FILE" | sort -u | xargs -P "$PARALLEL" -I{} bash -c 'download_one "$@"' _ {}

# Crawl JS bundles for more asset paths
discover_from_js() {
  find "$ROOT/assets" -name '*.js' -print0 2>/dev/null | while IFS= read -r -d '' js; do
    rg -o 'assets/[A-Za-z0-9_./-]+\.(?:js|css|drc|ktx2|font|icon|ogg|png|jpg|webp|wasm|glsl|vert|frag|wgsl)' "$js" 2>/dev/null || true
  done | sort -u
}

round=0
while [[ $round -lt 3 ]]; do
  new_urls=()
  while IFS= read -r path; do
    [[ -n "$path" ]] || continue
    url="$BASE_URL/$path"
    rel="$path"
    if [[ ! -f "$ROOT/$rel" ]]; then
      new_urls+=("$url")
    fi
  done < <(discover_from_js)

  if [[ ${#new_urls[@]} -eq 0 ]]; then
    break
  fi

  printf '%s\n' "${new_urls[@]}" | xargs -P "$PARALLEL" -I{} bash -c 'download_one "$@"' _ {}
  round=$((round + 1))
done

# Extract shader-like strings from bundles
SHADERS_DIR="$ROOT/shaders"
mkdir -p "$SHADERS_DIR"
ROOT="$ROOT" python3 - <<'PY'
import os
import re
from pathlib import Path

root = Path(os.environ["ROOT"])
out = root / "shaders"
out.mkdir(parents=True, exist_ok=True)

patterns = [
    re.compile(r'#version\s+\d+\s+es[\s\S]{80,12000}?(?=")', re.M),
    re.compile(r'precision\s+(?:highp|mediump|lowp)\s+float;[\s\S]{80,12000}?(?=")', re.M),
    re.compile(r'(?:vertex|fragment)_shader\s*=\s*`([\s\S]{80,12000}?)`', re.M),
]

seen = set()
idx = 0
for js in (root / "assets").glob("*.js"):
    text = js.read_text(errors="ignore")
    for pat in patterns:
        for m in pat.finditer(text):
            src = m.group(1) if m.lastindex else m.group(0)
            key = src.strip()[:200]
            if key in seen:
                continue
            seen.add(key)
            idx += 1
            kind = "vert" if "gl_Position" in src else ("frag" if "gl_FragColor" in src or "out vec4" in src else "glsl")
            (out / f"{js.stem}-{idx:03d}.{kind}").write_text(src.strip() + "\n")

print(f"extracted {idx} shader snippets")
PY

{
  echo "# Messenger reference manifest"
  echo "# Source: $BASE_URL"
  echo "# Generated: $(date -Iseconds)"
  find "$ROOT" -type f ! -name 'manifest.txt' | sort
} > "$MANIFEST"

echo "Done: $(find "$ROOT" -type f | wc -l) files, $(du -sh "$ROOT" | cut -f1)"
