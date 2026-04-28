# Bench Runner V2 Sprint Plan

## Status (as of 2026-04-28)

Goals 1 and 2 of the sprint are landed; Goal 3 now has a dry-run matrix, external-suite task planning, a Claude Code SDK execution boundary, and the first `browse_cli` tool handoff. The remaining Claude Code work is evaluator parity for the active agent benchmark datasets.

Landed in commits `61a801c4 first pass at bench runner` and `f4940b0a fixed benchmarks`, plus uncommitted refinements:

- `framework/benchTypes.ts` — `Harness`, `DEFAULT_BENCH_HARNESS`, `parseBenchHarness`, `BenchTaskKind`, `BenchMatrixRow`, executable-harness helpers, and the `BenchHarnessConfig` discriminated union (`StagehandHarnessConfig`, `ClaudeCodeHarnessConfig`, `CodexHarnessConfig`).
- `framework/benchHarness.ts` — `BenchHarness` interface, the `stagehand` harness implementation, the `claude_code` external execute seam, and a registry that keeps unsupported harnesses explicit.
- `framework/claudeCodeRunner.ts` — Claude Code SDK prompt/result adapter for `--harness claude_code`.
- `framework/externalHarnessPlan.ts` — typed task-plan extraction for `webvoyager`, `onlineMind2Web`, and `webtailbench` external harness runs.
- `framework/benchPlanner.ts` — pure `BenchPlanOptions`, `resolveBenchModelEntries`, `buildBenchMatrixRow`, `generateBenchTestcases`, `generateSuiteTestcases`. Auto-detects CUA mode from `AVAILABLE_CUA_MODELS`. Routes `agent/gaia` to the `--legacy` escape hatch via `legacyOnlySuites`.
- `framework/benchRunner.ts` — `executeBenchTask` now goes through `getBenchHarness(harness).start()`, with cleanup registered through the existing `activeRunCleanup` so SIGINT / `Esc` aggressive abort can close in-flight V3 sessions.
- `framework/runner.ts` and `framework/discovery.ts` — testcase metadata now carries `tier`, `task`, `harness`, `environment`, `api`, `provider`, `toolSurface`, `startupProfile`, `agentMode`. Suite testcases (`webvoyager`, `onlineMind2Web`, `webtailbench`) are decorated with the same metadata via `withBenchMetadata`.
- `tui/commands/parse.ts` — `--harness <name>` (validated through `parseBenchHarness`) and `--agent-mode <dom|hybrid|cua>` flags wired end to end.
- `tui/commands/run.ts` — `--dry-run` now emits an actual matrix view via `buildDryRunMatrix`, calling `generateBenchTestcases` + `buildBenchMatrixRow` so users can preview the model × harness × task expansion.
- `tests/framework/benchPlanner.test.ts` and harness-related cases in `tests/tui/parse.test.ts` — planner expansion, harness annotation, agent-mode override, unknown-harness rejection, defaulting to `stagehand`.

Still open:

- Shared external-harness evaluators for `webvoyager`, `onlineMind2Web`, and `webtailbench`. Claude Code can execute with `browse_cli`, but it does not yet reuse the dataset-specific Stagehand evaluator logic.
- Codex follow-up.
- Direct suite typed options (suite builders still consume env-based limit/sample/filter).
- Bench v2 → core tool-surface bridge (current Stagehand harness uses its native browser path; `toolSurface`/`startupProfile` are metadata-only on the bench side).

## Purpose

Bench runner v2 makes bench evals comparable across agent implementations, not just models. The new bench matrix is:

```text
model x harness x tool_surface x startup_profile x benchmark_task x trial
```

The important correction: **harness means agent implementation/orchestrator**. It is not runtime plumbing and it is not local-vs-API deployment.

## Current Baseline

Today, bench execution is effectively:

```text
model x implicit_stagehand_harness x implicit_stagehand_tooling x benchmark_task x trial
```

Current behavior:

- `framework/runner.ts` expands bench tasks into model x task testcases.
- `executeBenchTask()` initializes V3 through `initV3()`.
- Bench tasks receive `{ v3, agent, page, logger, input, modelName, debugUrl, sessionUrl }`.
- `--api` changes where the Stagehand agent runs, but it is still the Stagehand harness.
- Direct suite shorthands (`b:webvoyager`, `benchmark:onlineMind2Web`) still rely on env-driven suite options.

## Definitions

### Harness

A harness is the agent implementation being evaluated. It owns:

- agent loop
- prompting/state strategy
- tool-call protocol
- permission model
- session behavior
- how model outputs become browser actions

Initial harness contract:

```ts
type Harness = "stagehand" | "claude_code" | "codex";
```

Initial meanings:

- `stagehand`: Stagehand's agent loop, local or API-backed.
- `claude_code`: Claude Code / Claude Code SDK agent harness.
- `codex`: OpenAI Codex agent harness, likely CLI-driven at first.

Optional later harness candidates, not part of this sprint:

- `opencode`
- `hermes`
- `openclaw`

### Not A Harness

- `--api` is not a harness. It is `useApi` config/metadata for `harness: "stagehand"`.
- `stagehand_v3_core_tool` is not a harness. It is a composition of `harness: "stagehand"` with an injected or core-backed tool surface.
- Local vs remote execution is not a top-level axis for this sprint.

### Tool Surface

Tool surface is the browser/control interface exposed to the harness.

Existing core tool surfaces:

- `understudy_code`
- `playwright_code`
- `cdp_code`
- `playwright_mcp`
- `chrome_devtools_mcp`
- `browse_cli`

For the first slice, Stagehand uses its current native/default tool path. External harnesses should receive the **native agent-facing interface** for the selected tool surface, not the core-normalized `CorePageHandle` abstraction. Core page abstractions are what core evals test; bench v2 should test whether a harness can use the intended tool interface directly.

Native forwarding rules:

- MCP surfaces (`playwright_mcp`, `chrome_devtools_mcp`) should be passed through as MCP servers directly to the agent SDK when implemented. Do not proxy them through a synthetic MCP server unless there is no direct SDK path.
- CLI surfaces (`browse_cli`) should be exposed as CLI usage. For Claude Code, that means Bash access to a constrained `browse` wrapper pinned to one eval session.
- Code surfaces (`understudy_code`, `playwright_code`, `cdp_code`) should be exposed as a small runnable code harness or a limited set of code-generation/execution tools. Do not force them through `CorePageHandle`; the point is to compare the code-facing abstraction.

## Research Notes

Claude Code SDK is a strong first external harness candidate because its public docs describe it as built on the agent harness powering Claude Code. It supports headless, TypeScript, and Python entrypoints, plus tool permissions, sessions, and MCP extension points.

Codex is also a concrete agent harness candidate. Public docs describe Codex as a coding agent available through CLI/IDE/cloud surfaces; the CLI has local execution semantics, approval modes, and selected model support. Codex should follow after the browser/tool handoff contract is proven with Claude Code.

## Sprint Goals

### Goal 1: Extract Stagehand Into A Named Harness — ✅ done

Represent the current bench path as:

```ts
{
  harness: "stagehand",
  useApi: boolean,
}
```

This must be behavior-preserving.

### Goal 2: Add Matrix Metadata — ✅ done

Every bench testcase should include enough metadata to compare by:

- harness
- model
- provider
- environment
- useApi
- toolSurface, when selected or applicable
- startupProfile, when selected or applicable
- task
- category
- trial
- dataset, when applicable

### Goal 3: Prepare For Claude Code SDK — ◐ partial

Create the contracts and file boundaries needed for `claude_code`, but do not implement it until the Stagehand extraction is green.

Landed: `Harness` union accepts `"claude_code"`, `ClaudeCodeHarnessConfig` exists, parser accepts `--harness claude_code`, dry-run emits `claude_code` matrix rows, external suite inputs convert to a neutral task plan, and `claude_code` can execute through the SDK adapter with the `browse_cli` tool surface.

Outstanding: shared evaluation for external harness outputs. Until the active agent benchmark datasets use evals-owned evaluators, `claude_code` is supported for execution but should not be treated as benchmark-parity complete.

## Non-Goals

- Do not rewrite bench tasks.
- Do not implement representation tasks.
- Do not port every suite in this sprint.
- Do not add fanout UX for multiple models/tools/harnesses in one command.
- Do not replace `initV3`.
- Do not remove env compatibility from suite builders yet.
- Do not implement Codex before the Claude Code harness shape is proven.
- Do not make `opencode`, `hermes`, or `openclaw` part of the initial type contract.

## Proposed Files

Add:

- `packages/evals/framework/benchHarness.ts`
- `packages/evals/framework/benchPlanner.ts`
- `packages/evals/framework/benchRunner.ts`

Later, when direct suites move off env-only controls:

- `packages/evals/framework/benchSuites.ts`

## Proposed Types

```ts
type Harness = "stagehand" | "claude_code" | "codex";

type BenchTaskKind =
  | "act"
  | "extract"
  | "observe"
  | "agent"
  | "combination"
  | "suite";

interface BenchMatrixRow {
  model: string;
  provider?: string;
  harness: Harness;
  toolSurface?: ToolSurface;
  startupProfile?: StartupProfile;
  environment: "LOCAL" | "BROWSERBASE";
  useApi: boolean;
  task: string;
  category: string;
  trial: number;
  dataset?: string;
  params?: Record<string, unknown>;
}

interface BenchHarnessStartInput {
  row: BenchMatrixRow;
  logger: EvalLogger;
  modelClient?: unknown;
}

interface BenchHarnessContext {
  harness: Harness;
  row: BenchMatrixRow;
  logger: EvalLogger;

  v3?: V3;
  agent?: AgentInstance;
  page?: ReturnType<V3["context"]["pages"]>[number];

  core?: {
    session: CoreSession;
    page: CorePageHandle;
    tool: ToolSurface;
    startupProfile: StartupProfile;
  };

  debugUrl?: string;
  sessionUrl?: string;
  artifacts?: Artifact[];
}

interface BenchHarness {
  harness: Harness;
  supportedTaskKinds: BenchTaskKind[];
  supportedToolSurfaces?: ToolSurface[];
  supportsApi?: boolean;
  start(input: BenchHarnessStartInput): Promise<{
    ctx: BenchHarnessContext;
    cleanup: () => Promise<void>;
  }>;
}
```

## Execution Flow

```text
CLI tokens
  -> parseRunArgs()
  -> resolveRunOptions()
  -> discoverTasks()
  -> resolveTarget()
  -> BenchPlanner.expand()
  -> BenchRunner.execute()
  -> BenchHarness.start()
  -> defineBenchTask function
  -> scoring
  -> Braintrust metadata
  -> cleanup
```

## Planner Rules

The planner is pure. It should not:

- start browsers
- import Braintrust
- import task modules eagerly
- mutate env
- execute tasks

The planner should:

- expand tasks into deterministic `BenchMatrixRow[]`
- default `harness` to `stagehand`
- default `useApi` from current resolved run options
- use exactly `--model` when passed
- otherwise preserve existing model selection behavior:
  - `getAgentModelEntries()` for agent/external-agent categories
  - `getModelList(category)` for other bench categories
- preserve `--provider`
- preserve `--tool` and `--startup` as planned matrix metadata, but reject unsupported combinations once harness support is explicit
- preserve direct-suite `dataset`, `limit`, `sample`, and `filter` behavior via current env compatibility

## Runner Rules

`benchRunner.ts` should own bench row execution. It should:

- start the selected harness
- load the task module
- call the task function with a compatibility context
- preserve legacy bench task support while it exists
- emit progress events compatible with current TUI progress rendering
- preserve quiet/verbose behavior
- cleanup harness/session in `finally`
- return the same result shape expected by the current Braintrust Eval scorer path

## Stagehand Harness Slice

### Scope

First implementation slice:

- `harness: "stagehand"` only
- one explicit model in tests
- one `observe` task in planner tests
- current Stagehand V3 execution behavior unchanged
- `--api` preserved as `useApi`

### Required Changes

1. Add `BenchHarness` registry with only `stagehand`.
2. Move current `executeBenchTask()` initialization logic into the `stagehand` harness.
3. Keep the task context shape unchanged for existing `defineBenchTask` tasks.
4. Add `harness` and `useApi` metadata to generated bench testcases.
5. Add `--harness` parser support, defaulting to `stagehand`.
6. Reject unknown harness values before execution.

### Acceptance Criteria

- Existing bench commands still work:
  - `evals run observe -m openai/gpt-4.1-mini --dry-run`
  - `evals run dropdown -m openai/gpt-4.1-mini --dry-run`
  - `evals run b:webvoyager -l 2 -m openai/gpt-4.1-mini --dry-run`
- Dry-run output includes:
  - `harness: "stagehand"`
  - `useApi`
  - selected model
  - selected dataset, when applicable
- Unit tests cover planner expansion for:
  - one observe task
  - explicit model
  - default harness
  - unknown harness rejection
- Existing test suite remains green.
- Built CLI help/dry-run remain quiet.

## Claude Code SDK Spike

### Scope

Second implementation slice, after Stagehand harness extraction is green:

- `harness: "claude_code"`
- one small `observe` subset
- one explicit model
- one local environment path

### Integration Plan

Claude Code should receive the selected browser tool in its native form:

1. `browse_cli` first: create an isolated temp workspace containing a `browse` command wrapper on `PATH`. The wrapper calls `node packages/cli/dist/index.js --json --session <eval-session> ...`. Claude Code gets Bash permission only for `browse ...` commands and should discover usage through `browse -h` / subcommand help rather than receiving a prescriptive command script.
2. Direct MCP forwarding second: pass `playwright_mcp` / `chrome_devtools_mcp` to Claude Code SDK via `mcpServers` once the exact startup/auth shape is proven.
3. Code surfaces third: expose `understudy_code` and related code tools through a small generated script/module that Claude can edit or execute inside a sandbox.

Non-negotiables:

- no proxy MCP for `browse_cli`
- no generic `CorePageHandle` bridge for external bench harnesses
- no unrestricted Bash for Claude Code
- no built-in web tools by default; benchmark runs should go through the selected tool surface
- Braintrust metadata for CLI-backed tool surfaces must include the command and version, e.g. `toolCommand: "browse"`, `browseCliVersion`, and `browseCliEntrypoint`.

### Acceptance Criteria

- `evals run b:webvoyager --harness claude_code --tool browse_cli -m <model> --dry-run` produces valid rows with `toolSurface: "browse_cli"` and a concrete startup profile.
- One actual `claude_code + browse_cli` run can execute one WebVoyager case without an env unlock.
- Max-turn termination returns a normal task artifact/result instead of a harness exception, so the evaluator layer can still assess partial work.
- Braintrust metadata distinguishes:
  - `harness: "claude_code"`
  - model
  - tool surface
  - startup profile
  - task/category/trial
- Stagehand harness behavior remains unchanged.

## Shared External Evaluator Follow-Up

The current Stagehand agent task files, such as `tasks/bench/agent/webvoyager.ts`, still own their dataset-specific evaluation path. External harnesses bypass those task modules and currently produce direct task results from their own transcripts/final answers. That is useful for smoke testing but not enough for parity.

Next implementation target:

```text
dataset scenario -> harness execution artifact -> evals-owned evaluator -> TaskResult
```

Scope:

- `webvoyager`
- `onlineMind2Web`
- `webtailbench`

Rules:

- Keep the existing Stagehand task path untouched until the shared evaluator is proven.
- Add evaluator code inside `packages/evals`, not a separate package yet.
- Harnesses should produce artifacts only: instruction, start URL, final URL/page state when available, final answer, reasoning/transcript, screenshots if available, logs, and harness stop status.
- Evaluators should not know whether the artifact came from Stagehand, Claude Code, Codex, or another harness.
- Max-step/max-turn outcomes are evaluatable artifacts, not harness exceptions.

Initial evaluator can be text-first for external harnesses, then add screenshots/page-state capture from `browse_cli` once the artifact path is stable.

## Codex Follow-Up

Codex should wait until the harness contract is proven with Claude Code.

Open questions for Codex:

- CLI vs SDK control path
- how to inject browser tools
- how to constrain file/command permissions during browser evals
- how to capture structured outputs for scoring
- whether Codex is appropriate for non-coding browser tasks without a custom prompt/tool layer

## Braintrust Naming And Metadata

For the first sprint, keep one Braintrust experiment per logical CLI run.

Experiment names should include singular high-signal axes when available:

- target
- environment
- harness
- tool surface
- startup profile
- model when a single model is selected

Examples:

- `observe_local_stagehand_openai_gpt_4_1_mini_apr27_1530`
- `observe_local_claude_code_playwright_code_runner_provided_local_cdp_apr27_1530`
- `webvoyager_browserbase_stagehand_api_openai_gpt_4_1_mini_apr27_1530`

Metadata matters more than names. Every testcase should carry:

```ts
{
  tier: "bench",
  harness,
  useApi,
  model,
  provider,
  environment,
  toolSurface,
  startupProfile,
  dataset,
  category,
  task,
  trial,
}
```

## Test Plan

Unit tests:

- planner expands one observe task with explicit model and default `stagehand`
- planner rejects unknown harness
- parser accepts `--harness stagehand`
- parser rejects or surfaces unknown harness before execution
- dry-run includes matrix metadata

CLI smoke:

- source `evals run observe --dry-run`
- built `evals run observe --dry-run`
- source `evals run observe --harness stagehand --dry-run`
- built `evals run observe --harness stagehand --dry-run`
- invalid `--harness nope` exits nonzero

Regression checks:

- `evals list`
- `evals config`
- `evals experiments`
- quiet command paths still avoid eager Braintrust warnings

## Implementation Order

1. ✅ Add `Harness` types and stagehand-only registry. (`framework/benchTypes.ts`, `framework/benchHarness.ts`)
2. ✅ Add pure `benchPlanner.ts`. (`framework/benchPlanner.ts`)
3. ✅ Add planner unit tests. (`tests/framework/benchPlanner.test.ts`)
4. ✅ Add parser support for `--harness`. (`tui/commands/parse.ts` + `tests/tui/parse.test.ts` cover default / accepted / rejected)
5. ✅ Route current bench execution through `benchRunner.ts` and the `stagehand` harness. (`framework/benchRunner.ts`)
6. ✅ Add matrix metadata to bench testcases. (planner + suite builders both annotate `tier/task/harness/environment/api/provider/toolSurface/startupProfile/agentMode`)
7. ✅ Verify no behavior change for existing Stagehand bench runs. (existing CLI smokes pass; suite shorthands `b:webvoyager` / `b:onlineMind2Web` / `b:webtailbench` still work)
8. ◐ Add Claude Code SDK spike behind `harness: "claude_code"` (dry-run + gated SDK adapter landed; browser/tool handoff pending).
9. ⬜ Revisit direct suite typed options.
10. ⬜ Revisit Codex once browser/tool handoff is clear.

## Done Criteria For This Sprint

- ✅ Stagehand bench path is represented as `harness: "stagehand"`.
- ✅ Existing bench commands preserve behavior.
- ✅ `--harness stagehand` works (default; `--harness claude_code` parses but rejects at execution time with a clear message).
- ✅ Dry-run and Braintrust metadata expose the bench matrix axes.
- ✅ The next harness spike has a documented entry point and acceptance criteria (this file's "Claude Code SDK Spike" section).

## Beyond Original Sprint Scope

Items that landed alongside the bench-runner work but were not part of the original goals listed above:

- **`--agent-mode <dom|hybrid|cua>`** — added on top of the harness flag so a single Stagehand harness run can pick its agent tool mode. Validated in `parse.ts` (`normalizeAgentMode`) and threaded through to `initV3` via the harness.
- **CUA auto-detection** — `resolveAgentModeForModel` in `benchPlanner.ts` auto-picks `cua` when the model is in `AVAILABLE_CUA_MODELS`, otherwise `hybrid`. `--agent-mode` overrides this.
- **`webtailbench` wired as a third supported direct suite** alongside `webvoyager` and `onlineMind2Web` (added in `f4940b0a`).
- **`agent/gaia` gated as legacy-only** via `legacyOnlySuites` in the planner; throws a hard error pointing the user at `--legacy` or one of the supported suites.
- **`--dry-run` matrix view** — `buildDryRunMatrix` in `tui/commands/run.ts` materializes the full row-per-testcase preview (model × harness × task × dataset, plus the resolved `BenchHarnessConfig`), instead of just listing target/tasks.
- **Esc-to-abort plumbing** — `RunEvalsOptions.signal` on the runner; cooperative abort short-circuits unstarted testcases and aggressive abort closes V3 sessions immediately. `tui/repl.ts` does cooperative-then-aggressive double-press; argv mode forwards Esc → SIGINT.
- **`experiments` command** (`8d38a2ad`) reads bench metadata for comparisons; the metadata work above makes its summaries cross-axis comparable.
- **`framework/braintrust.ts`, `framework/taskLoader.ts`, `framework/activeRunCleanup.ts`** — extracted helpers split off from `runner.ts` while bench was being lifted out.
