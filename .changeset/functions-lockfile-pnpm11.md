---
"browse": patch
---

Fix Functions publish and init for private npm registries and pnpm 11. `functions publish` omits registry URLs from the `package-lock.json` it generates, so builds do not fail when your npm registry is private, and prints npm output when lockfile generation fails. `functions init` writes `pnpm-workspace.yaml` so pnpm 11 allows the esbuild build script.
