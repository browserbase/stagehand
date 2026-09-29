---
"browse": patch
---

Fix Functions builds that failed because of how `functions publish` generated `package-lock.json` or how `functions init` set up pnpm:

- `functions publish` now generates `package-lock.json` without registry URLs, so private npm registries work.
- `functions publish` now resolves local `file:` dependencies by building `package-lock.json` from the uploaded files rather than just `package.json`.
- `functions publish` now prints npm's error output when it can't generate `package-lock.json`.
- `functions init` now writes a `pnpm-workspace.yaml` that allows the esbuild build script, required by pnpm 11+.
