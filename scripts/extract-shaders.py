#!/usr/bin/env python3
"""Extract GLSL shader sources embedded in Messenger JS bundles."""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "reference" / "messenger.abeto.co"
OUT = ROOT / "shaders"

TEMPLATE = re.compile(r"`([^`]{120,20000}?)`", re.S)
GLSL_HINT = re.compile(
    r"(#version\s+\d+\s+es|precision\s+(?:highp|mediump|lowp)\s+float;|gl_Position|gl_FragColor|uniform\s+\w+)"
)


def shader_kind(src: str) -> str:
    if "gl_Position" in src and "gl_FragColor" not in src and "out vec4" not in src:
        return "vert"
    if "gl_FragColor" in src or "out vec4" in src:
        return "frag"
    return "glsl"


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    seen: set[str] = set()
    count = 0

    for js in sorted((ROOT / "assets").glob("*.js")):
        text = js.read_text(errors="ignore")
        for m in TEMPLATE.finditer(text):
            src = m.group(1).strip()
            if not GLSL_HINT.search(src):
                continue
            key = src[:300]
            if key in seen:
                continue
            seen.add(key)
            count += 1
            kind = shader_kind(src)
            (OUT / f"{js.stem}-{count:03d}.{kind}").write_text(src + "\n")

    print(f"extracted {count} shaders to {OUT}")


if __name__ == "__main__":
    main()
