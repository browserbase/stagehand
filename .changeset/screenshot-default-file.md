---
"browse": patch
---

`browse screenshot` now writes a file by default instead of printing base64 to stdout. Bare invocations save to `screenshot-<yyyymmdd-hhmmss>.<type>` in the current directory (with a collision counter instead of overwriting) and print `{ "saved": "<path>" }`. A new `--base64` flag preserves the legacy behavior of printing `{ "base64": "..." }` to stdout; it is mutually exclusive with `--path`. `--path` behavior is unchanged.

Note for scripts that parsed the bare-invocation base64 output: pass `--base64` to keep the old stdout contract.
