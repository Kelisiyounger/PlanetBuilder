# messenger-copy

Unofficial learning workspace that mirrors assets, shaders, and scene structure from [**Messenger**](https://messenger.abeto.co/) by [abeto](https://abeto.co/).

> **Disclaimer:** This is not the real game. It is a local, AI-assisted rebuild for study only. All original art, audio, and design remain the property of their respective owners. See [ATTRIBUTION.md](./ATTRIBUTION.md).

## What this is

- A SvelteKit + Three.js preview with **Intro**, **Gameplay**, and **NPC** scene modes
- Downloaded reference bundles under `reference/messenger.abeto.co/`
- Ported/simplified GLSL materials, Draco loaders, and post-processing experiments

## License

- **Repository code** (`src/`, scripts, config): [MIT](./LICENSE)
- **Reference assets** (`reference/`, `static/messenger`): belong to the original Messenger project — do not redistribute without permission

## Develop

```sh
pnpm install
pnpm setup:assets
pnpm dev
```

Open [http://localhost:5173](http://localhost:5173).

### Windows: `static/messenger`

`static/messenger` is a symlink in git. Windows checks it out with
`core.symlinks=false`, which turns it into a plain text file, so Vite cannot
serve `/messenger/*` and every scene fails to load. `pnpm setup:assets`
creates a junction to `reference/messenger.abeto.co/assets` instead.

```bat
cmd /c mklink /J "static\messenger" "reference\messenger.abeto.co\assets"
```

### Reference tooling

```sh
pnpm reference:discover   # find asset URLs from bundles
pnpm reference:download   # fetch missing reference files
pnpm reference:shaders    # extract GLSL from JS bundles
pnpm reference:crawl-avatar  # 进入游戏并抓取 avatar / EXR 等未镜像资产
```

## Stack

- SvelteKit 2 / Svelte 5
- Three.js r184
- TypeScript, Tailwind CSS, Vitest
