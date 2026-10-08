# Recorded benchmark pages

These are captures of the public mirrors already used by the migrated benchmarks:

- `aigrant`: https://browserbase.github.io/stagehand-eval-sites/sites/aigrant/
- `file-uploads-3`: https://browserbase.github.io/stagehand-eval-sites/sites/file-uploads-3/
- `csa`: https://browserbase.github.io/stagehand-eval-sites/sites/csa/
- `professional-info`: https://browserbase.github.io/stagehand-eval-sites/sites/professional-info/
- `resistor`: https://browserbase.github.io/stagehand-eval-sites/sites/resistor/
- `ionwave`: https://browserbase.github.io/stagehand-eval-sites/sites/ionwave/

Each `manifest.json` records the original URL, capture time, viewport, recorder
limitations, and SHA-256 of the uncompressed HTML. The `.html.gz` files contain
the recorder's unmodified HTML; gzip only reduces storage size. The recorder
removes scripts and remote assets. Captures use fresh unauthenticated public sessions. AI Grant has no inputs,
and file upload has one file input without a value. The additional captures
contain public default form values (a publication date, resistor part number,
and button labels); no account credentials or user-entered data are included.
Original page text and link attribution remain in the captures.

## Inspect or refresh

From `packages/evals`, inspect an artifact without changing the tracked file:

```sh
gzip -dc assets/observation-tasks/aigrant/index.html.gz > /tmp/aigrant-recorded.html
```

To refresh, record into a **new** directory, using the source URL in the existing
manifest. These static mirrors need no setup script; the recorder waits for
page load. For example:

```sh
pnpm task:record \
  --url https://browserbase.github.io/stagehand-eval-sites/sites/aigrant/ \
  --out /tmp/aigrant-refresh
```

Review the new HTML, then package it and add its digest (the argument is the new
capture directory):

```sh
python3 - /tmp/aigrant-refresh <<'PY'
import gzip, hashlib, json, pathlib, sys
directory = pathlib.Path(sys.argv[1])
html = (directory / "index.html").read_bytes()
(directory / "index.html.gz").write_bytes(gzip.compress(html, mtime=0))
manifest = json.loads((directory / "manifest.json").read_text())
manifest["htmlSha256"] = hashlib.sha256(html).hexdigest()
(directory / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
PY
```

Copy only `index.html.gz` and `manifest.json` into the corresponding asset
directory. Rerun the offline tests, the opt-in source comparison, and real-model
validation described in `tasks/README.md` before accepting the refresh.
Do not update expected task results just to accommodate a changed recording.

## Validation

All 37 extraction/observation tasks were audited; see [AUDIT.md](./AUDIT.md) for
all decisions and exclusions. Seven tasks across six captured pages preserve the
source observation. The original two pages were captured on 2026-10-04; the four
additional pages were captured on 2026-10-07. Captured HTML is unmodified except
for gzip packaging and the added manifest digest.

Local offline checks verify required observation content, all manifest hashes,
and a negative control for missing company text. Source comparisons preserve
nonempty accessible text and hierarchy, normalizing only session-local IDs,
whitespace-only text nodes, and blank link names.

Validation on 2026-10-07 passed all 45 checks: nine offline, eight live-source,
21 real-model pairs, and seven Browserbase comparisons. All 42 real-model task
runs passed the original assertions with `openai/gpt-5.4-mini` (three runs per
task and page variant). All 14 Browserbase sessions passed observation comparison
using deterministic adapters without paid inference. The six packaged recordings
also loaded through the compiled helper in offline Chrome. These are migration
checks, not a statistical guarantee about every model.
