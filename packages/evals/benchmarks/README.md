# Benchmarks — the three-axis run matrix

A benchmark manifest (`*.bench.json`) pins the full space a run covers, so
every score is attributable to a **(model, harness, toolSurface)** triple —
never just a model.

| Axis          | Values                                                                                                                               | Meaning                                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `model`       | `provider/model` strings                                                                                                             | The LLM driving the run                                                                                      |
| `harness`     | `stagehand`, `claude_code`, `codex`                                                                                                  | What agentic loop executes the task: the Stagehand SDK itself, or an external coding harness                 |
| `toolSurface` | `understudy_code` (v3 SDK), `v4_code` (v4 SDK), `playwright_code`, `cdp_code`, `playwright_mcp`, `chrome_devtools_mcp`, `browse_cli` | What the harness uses to control the browser: writing code against an SDK, or calling packaged MCP/CLI tools |

## Manifest shape

```jsonc
{
  "name": "webvoyager-harness-matrix",
  "target": { "kind": "suite", "suite": "webvoyager", "limit": 25 },
  // or: { "kind": "tasks", "include": ["act", "extract/extract_repo_name"] }
  "matrix": {
    "models": ["anthropic/claude-haiku-4-5"],
    "harnesses": ["claude_code", "codex"],
    "toolSurfaces": ["v4_code", "playwright_mcp"],
  },
  "trials": 1,
}
```

`expand.ts` produces one run row per **valid** combination; invalid points
are reported with reasons, not silently dropped. Current validity rule: the
`stagehand` harness _is_ the SDK, so it only pairs with the SDK code
surfaces (`understudy_code`, `v4_code`); external harnesses pair with any
surface.

## Grading (nondeterministic suite)

External-harness runs are graded by rubric through `V3Evaluator` from v3
core, carried by a **never-`init()`-ed** `V3` instance that exists only to
hold an LLM client — it never drives a browser (see
`framework/benchHarness.ts` `buildVerifierCarrierV3`). This is a deliberate
keep-less-code decision (2026-07-23): the v3-carried grader is
battle-tested and keeps LLMJ scores comparable with historical v3-graded
agent-suite results. So v3 symbols appearing in grading traces are
expected and grading-only; all _driving_ in a `v4_code` arm goes through
`initV4` and the v4 extension stack. If v3 must ever leave the loop
entirely, a standalone AI-SDK judge is a ~150-line build (one existed
briefly as `framework/llmJudge.ts`, removed 2026-07-23 as dead code once
the replay harness was dropped — see git history) — rebuild it only when
deliberately cutting over score baselines.

## Status

- Schema, expansion, and validity rules: implemented here (`schema.ts`,
  `expand.ts`), tested in `tests/framework/benchmarksManifest.test.ts`.
- `v4_code` tool surface: implemented in `core/tools/v4_code.ts` (the v4
  analogue of `understudy_code`). Coordinate targets are unsupported —
  the v4 SDK is DOM-only (no click(x,y)); see the class doc for the full
  capability map.
- Planner/CLI wiring (a `--benchmark <name>` entry point consuming
  `loadBenchmarksDir()`): pending — deferred while framework/ files are
  under concurrent migration (2026-07-23). The expander is
  dependency-free so the planner can adopt it without rework.
