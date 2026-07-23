# General nondeterministic harness — scoping (2026-07-23)

Goal: one pipeline that runs any dataset task (WebVoyager, GAIA,
OnlineMind2Web, WebTailBench) under any agent harness (claude_code, codex)
over any tool surface (v4_code, playwright_code, playwright_mcp, cdp_code,
chrome_devtools_mcp, understudy_code, browse_cli), graded by one rubric
LLMJ, reported to Braintrust project `stagehand-v4` with the
(model, harness, toolSurface) triple. "Playwright benches" are not a
separate thing — they are manifest rows whose toolSurface is a playwright
variant.

## Problem

Every tool surface is implemented twice: once as a `CoreTool`
(`core/tools/*`, deterministic tier) and once as harness-specific prep
(`framework/claudeCodeToolAdapter.ts` per-surface functions;
`codexToolAdapter.ts` supports only browse_cli). Result: codex lags
surfaces, playwright_mcp is wired nowhere agentic, and each new surface
costs one implementation per harness.

## Design: ToolAdapter = CoreTool + prepareLLMExposure

```ts
interface LLMExposure {
  kind: "code_handles" | "mcp_server" | "cli";
  handles?: Record<string, unknown>; // code: { stagehand, page, z } etc.
  promptInstructions: string;
  mcpServers?: Record<string, unknown>; // mcp: mounted as-is by the harness
  command?: { bin: string; env: Record<string, string> };
  cleanup: () => Promise<void>;
}
```

Each surface module exports a standalone
`prepareLLMExposure(plan, env, logger, startupProfile?)` function next to
its CoreTool (a `ToolAdapter` interface was considered and dropped as
unnecessary code — the function convention is the contract).

Harness drivers keep exactly three mount points and no surface knowledge:

- `code_handles` → wrap in the harness's single run tool (CC: sdk MCP tool,
  exists today; codex: its exec/MCP equivalent)
- `mcp_server` → mount config directly (this wires playwright_mcp /
  chrome_devtools_mcp for free)
- `cli` → spawn with env (browse_cli)

Grading is unchanged and shared: `gradeExternalTrajectory` → rubric LLMJ
via the never-`init()`-ed V3 carrier (grading only, never driving — see
README.md "Grading"). GAIA additionally threads its ground-truth
`expected` into a single exact-match criterion.

Cadence/config is the existing benchmark manifest
(model × harness × toolSurface, `*.bench.json`); runner routing and triple
metadata are already live.

## Phases (independently shippable)

1. Extract `LLMExposure`; move claude_code's 4 per-surface preps into the
   surface modules; CC consumes exposures. Behavior-preserving (re-verify
   with the passing WebVoyager v4_code arm). Net-negative LOC. Also add
   `STAGEHAND_V4_SDK_PATH` (env override for the v4 checkout consumed by
   initV4 + the .v4-sdk-types regen; defaults to the package link).
2. Codex consumes exposures → gains all surfaces at once (supersedes
   per-surface codex wiring).
3. Un-legacy GAIA: add `buildGAIATestcases` to the suite map, `gaia` to the
   `ExternalHarnessTaskPlan` dataset union, thread `expected` through to
   the verifier criterion.
4. `--benchmark <name>` CLI entry consuming `loadBenchmarksDir()` (after
   the framework migration churn settles).

Non-goals (per the minimal-code directive): a scaffold-neutral `llm_loop`
harness (only if scaffold bias shows in real numbers); replacing the
grader; any agent surface in v4.
