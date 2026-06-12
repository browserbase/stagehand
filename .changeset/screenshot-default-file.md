---
"browse": minor
---

`browse screenshot` now writes a file by default instead of printing base64 to stdout. Bare invocations save to `screenshot-<yyyymmdd-hhmmss>.<type>` in the current directory (with a collision counter instead of overwriting) and print `{ "saved": "<path>" }`. A new `--base64` flag preserves the legacy behavior of printing `{ "base64": "..." }` to stdout; it is mutually exclusive with `--path`. `--path` behavior is unchanged.

This is a minor (not patch) bump because bare `browse screenshot` changes its stdout contract from `{ base64 }` to `{ saved }` — scripts that parsed the base64 output must now pass `--base64`.
