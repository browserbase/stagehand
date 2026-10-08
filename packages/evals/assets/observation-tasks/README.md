# Recorded benchmark pages

These are captures of the public mirrors already used by the migrated benchmarks:

- `aigrant`: https://browserbase.github.io/stagehand-eval-sites/sites/aigrant/
- `file-uploads-3`: https://browserbase.github.io/stagehand-eval-sites/sites/file-uploads-3/

Each `manifest.json` records the original URL, capture time, viewport, recorder
limitations, and SHA-256 of the uncompressed HTML. The `.html.gz` files contain
the recorder's unmodified HTML; gzip only reduces storage size. The recorder
removes scripts and remote assets. Review found no form values in either capture:
AI Grant has no inputs, and file upload has one file input without a value.
Original page text and link attribution remain in the captures.

## Inspect or refresh

From `packages/evals`, inspect an artifact without changing the tracked file:

```sh
gzip -dc assets/observation-tasks/aigrant/index.html.gz > /tmp/aigrant-recorded.html
```

To refresh, record into a **new** directory, using the source URL in the existing
manifest. These two static mirrors need no setup script; the recorder waits for
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

The initial 2026-10-04 captures pass the three original benchmark assertions with
the deterministic adapter, and their normalized Stagehand prompts match the public
source pages. Deliberately replacing the Coframe link text is detected. The
Geniusee link-extraction page is excluded because its frames are unsupported.

Real-model validation used `openai/gpt-5.4-mini` through Stagehand's normal provider
integration in local Chrome. The initial 2026-10-04 run was repeated on 2026-10-07
after adopting the merged task recorder and updating to current `main`. Each task
ran three times per page variant, using its original success assertion:

| Task                         | Public source | Saved recording |
| ---------------------------- | ------------- | --------------- |
| `extract_aigrant_targeted`   | 3/3 pass      | 3/3 pass        |
| `extract_aigrant_targeted_2` | 3/3 pass      | 3/3 pass        |
| `observe_file_uploads`       | 3/3 pass      | 3/3 pass        |

All 18 task runs passed. This is a small migration check, not a statistical claim
about every model.

Browserbase validation on 2026-10-07 also passed all three task comparisons
(six cloud sessions). Each task passed its original assertions on both the public
source and saved recording, and the normalized Stagehand observation prompts
matched. This cloud check used the deterministic adapter, not paid model calls;
it validates remote replay and observation fidelity. Run it with the opt-in
`TASK_VALIDATION_BROWSERBASE=1` command in `tasks/README.md`.
