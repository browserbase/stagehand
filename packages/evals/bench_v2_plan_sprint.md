# Bench Runner V2 Sprint Plan

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

For the first slice, Stagehand uses its current native/default tool path. Tool injection is metadata-only until a real bridge exists.

## Research Notes

Claude Code SDK is a strong first external harness candidate because its public docs describe it as built on the agent harness powering Claude Code. It supports headless, TypeScript, and Python entrypoints, plus tool permissions, sessions, and MCP extension points.

Codex is also a concrete agent harness candidate. Public docs describe Codex as a coding agent available through CLI/IDE/cloud surfaces; the CLI has local execution semantics, approval modes, and selected model support. Codex should follow after the browser/tool handoff contract is proven with Claude Code.

## Sprint Goals

### Goal 1: Extract Stagehand Into A Named Harness

Represent the current bench path as:

```ts
{
  harness: "stagehand",
  useApi: boolean,
}
```

This must be behavior-preserving.

### Goal 2: Add Matrix Metadata

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

### Goal 3: Prepare For Claude Code SDK

Create the contracts and file boundaries needed for `claude_code`, but do not implement it until the Stagehand extraction is green.

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

### Integration Question

The key design question is how the Claude Code SDK receives browser tools.

Preferred exploration order:

1. MCP-backed browser tools, because Claude Code SDK documents MCP extensibility.
2. A small custom tool bridge if MCP is too heavy for the first spike.
3. Direct CLI/headless mode only if SDK integration blocks.

### Acceptance Criteria

- `evals run observe --harness claude_code -m <model> --dry-run` produces valid rows.
- One actual `claude_code` run can execute a tiny observe subset locally.
- Braintrust metadata distinguishes:
  - `harness: "claude_code"`
  - model
  - tool surface
  - startup profile
  - task/category/trial
- Stagehand harness behavior remains unchanged.

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

1. Add `Harness` types and stagehand-only registry.
2. Add pure `benchPlanner.ts`.
3. Add planner unit tests.
4. Add parser support for `--harness`.
5. Route current bench execution through `benchRunner.ts` and the `stagehand` harness.
6. Add matrix metadata to bench testcases.
7. Verify no behavior change for existing Stagehand bench runs.
8. Add Claude Code SDK spike behind `harness: "claude_code"`.
9. Revisit direct suite typed options.
10. Revisit Codex once browser/tool handoff is clear.

## Done Criteria For This Sprint

- Stagehand bench path is represented as `harness: "stagehand"`.
- Existing bench commands preserve behavior.
- `--harness stagehand` works.
- Dry-run and Braintrust metadata expose the bench matrix axes.
- The next harness spike has a documented entry point and acceptance criteria.
