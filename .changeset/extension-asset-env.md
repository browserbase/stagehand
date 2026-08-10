---
"@browserbasehq/stagehand": patch
---

Allow overriding the extension asset locations via `STAGEHAND_EXTENSION_ARCHIVE_PATH` and `STAGEHAND_EXTENSION_DIRECTORY_PATH` environment variables. Bundlers that inline the SDK (nitro, eve) re-anchor `import.meta.url`, breaking the derived paths; the env vars let hosts point at the real installed assets.
