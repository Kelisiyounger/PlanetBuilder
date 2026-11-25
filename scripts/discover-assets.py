#!/usr/bin/env python3
"""Discover and download Messenger assets referenced in captured JS bundles."""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import urljoin

BASE = "https://messenger.abeto.co"
ROOT = Path(__file__).resolve().parents[1] / "reference" / "messenger.abeto.co"
ASSETS = ROOT / "assets"

IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".ktx2", ".icon"}
AUDIO_EXT = {".ogg", ".mp3", ".wav"}
FONT_EXT = {".font", ".woff", ".woff2", ".ttf", ".otf"}
GEO_EXT = {".drc", ".glb", ".gltf", ".obj"}

PATTERNS = [
    re.compile(r'["\']([^"\']+\.(?:drc|ktx2|png|jpg|webp|font|icon|ogg|wasm|json))["\']'),
    re.compile(r'load(?:Curves)?\(\s*["\']([^"\']+)["\']'),
    re.compile(r'batched\(\s*["\']([^"\']+)["\']'),
]


def resolve_url(rel: str) -> str | None:
    rel = rel.lstrip("./")
    if rel.startswith("assets/"):
        return f"{BASE}/{rel}"

    ext = Path(rel).suffix.lower()
    if ext in GEO_EXT or rel.startswith("planets/") or rel.startswith("birds/"):
        return f"{BASE}/assets/geometries/{rel}"
    if ext in IMAGE_EXT or rel.startswith("images/"):
        return f"{BASE}/assets/images/{rel.removeprefix('images/')}"
    if ext in AUDIO_EXT or rel.startswith("audio/"):
        return f"{BASE}/assets/audio/{rel.removeprefix('audio/')}"
    if ext in FONT_EXT or rel.startswith("fonts/"):
        return f"{BASE}/assets/fonts/{rel.removeprefix('fonts/')}"
    if ext == ".js" or ext == ".wasm":
        return f"{BASE}/assets/{rel}"
    return None


def collect_paths() -> set[str]:
    found: set[str] = set()
    for js in ASSETS.rglob("*.js"):
        text = js.read_text(errors="ignore")
        for pat in PATTERNS:
            for m in pat.finditer(text):
                rel = m.group(1).strip()
                if any(x in rel for x in ("http://", "https://", "data:", "blob:", "#")):
                    continue
                found.add(rel)
    return found


def local_path(url: str) -> Path:
    return ROOT / url.removeprefix(f"{BASE}/")


def download(url: str) -> bool:
    dest = local_path(url)
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.is_file() and dest.stat().st_size > 0:
        return True
    try:
        subprocess.run(
            ["curl", "-fsSL", "--retry", "3", "--retry-delay", "1", url, "-o", f"{dest}.tmp"],
            check=True,
            capture_output=True,
        )
        Path(f"{dest}.tmp").replace(dest)
        return True
    except subprocess.CalledProcessError:
        print(f"FAILED {url}", file=sys.stderr)
        return False


def main() -> None:
    rels = collect_paths()
    urls = sorted({u for r in rels if (u := resolve_url(r))})

    ok = 0
    for url in urls:
        if download(url):
            ok += 1

    manifest = ROOT / "discovered-urls.txt"
    manifest.write_text("\n".join(urls) + "\n")
    print(f"discovered {len(rels)} relative paths -> {len(urls)} urls, downloaded/verified {ok}")


if __name__ == "__main__":
    main()
