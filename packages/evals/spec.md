# Evals Overhaul Spec

## Overview

The evals package is a 3-tier evaluation system for Stagehand: **core** (deterministic tool surface comparison), **bench** (LLM agent benchmarks), and **interpret** (future: AI interpretability). Phase 1 built the infrastructure. The next phase introduces adapter-abstracted core tasks.

---

## Principles

### 1. Tool surface is the unit under test in core

Core compares concrete tool surfaces, not abstract libraries:

- `understudy_code` vs `playwright_code`
- `understudy_code` vs `browse_cli`
- `playwright_code` vs `playwright_mcp`

### 2. Startup is part of the product

Browser acquisition behavior differs by tool surface. Core measures startup separately, not hides it.

### 3. Representation stays inside core

Textual page representation (snapshots, accessibility trees, refs) is a core offering. Representation tasks are deterministic core tasks evaluated by coverage, fidelity, actionability, and token efficiency — not LLM judges.

### 4. Tasks stay code-first

Core tasks are TypeScript with explicit assertions. Fixtures provide reusable typed targets but tasks remain straightforward code, not a DSL.

---

## Comparison axes

### Core matrix

```
tool_surface × startup_profile × task × trial
```

### Bench matrix

```
model × harness × tool_surface × startup_profile × benchmark_task × trial
```

Bench v1 currently collapses `harness × tool_surface × startup_profile` into the implicit V3 path. Bench runner v2 makes those axes explicit while preserving existing bench task discovery and CLI targets.

### Tool surfaces

```typescript
type ToolSurface =
  | "understudy_code"
  | "playwright_code"
  | "cdp_code"
  | "playwright_mcp"
  | "chrome_devtools_mcp"
  | "browse_cli";
```

### Startup profiles

```typescript
type StartupProfile =
  | "runner_provided_local_cdp"
  | "runner_provided_browserbase_cdp"
  | "tool_launch_local"
  | "tool_attach_local_cdp"
  | "tool_create_browserbase"
  | "tool_attach_browserbase";
```

### Reporting metadata

```typescript
type EnvironmentName = "local" | "browserbase";
type BrowserOwnership = "runner" | "tool";
type ConnectionMode =
  | "launch"
  | "attach_ws"
  | "attach_http"
  | "browserbase_native";
```

### Bench runner v2 types

Bench runner v2 introduces a first-class harness layer. A harness is the agent implementation being evaluated: it owns the agent loop, prompting/state strategy, tool-call protocol, permissions, and how model outputs become browser actions. The tool surface is the browser/control interface exposed to that harness. The model is the language model powering that harness.

Research notes from current public docs:

- Claude Code SDK is explicitly built on the agent harness that powers Claude Code and exposes headless, TypeScript, and Python SDK entrypoints with tools, permissions, sessions, and MCP extension points.
- Codex is a coding agent available through CLI/IDE/cloud surfaces; the CLI runs locally, has approval modes, can read/write/run commands depending on mode, and can be driven with a selected model.

```typescript
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
  environment: EnvironmentName;
  useApi?: boolean;
  task: string;
  category: string;
  trial: number;
  dataset?: string;
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

  // Existing Stagehand compatibility path.
  v3?: V3;
  agent?: AgentInstance;
  page?: ReturnType<V3["context"]["pages"]>[number];

  // Browser/control surface exposed to external harnesses.
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
  start(input: BenchHarnessStartInput): Promise<{
    ctx: BenchHarnessContext;
    cleanup: () => Promise<void>;
  }>;
}
```

Initial harness meanings:

| Harness              | Meaning                                                                                              |
| -------------------- | ---------------------------------------------------------------------------------------------------- |
| `stagehand`          | Stagehand's agent loop, whether run locally or through the Stagehand API                             |
| `claude_code`        | Claude Code / Claude Code SDK agent harness, including its permissions, sessions, tools, and MCP use |
| `codex`              | OpenAI Codex agent harness, initially CLI-driven                                                    |

Stagehand local and Stagehand API are the same harness. `--api` / `USE_API` should remain `useApi` run configuration and metadata, not a separate harness.

Optional later harness candidates, not part of the initial contract:

- `opencode`
- `hermes`
- `openclaw`
- `pi`

The first implementation slice should keep `defineBenchTask` source compatibility. Existing tasks should not need rewrites just to run under the `stagehand` harness.

### Bench runner v2 execution flow

```text
CLI flags/config/env
  ↓
ResolvedRunOptions
  ↓
discovery.resolveTarget()
  ↓
BenchPlanner.expand()
  ↓
BenchMatrixRow[]
  ↓
BenchRunner.execute(row)
  ↓
BenchHarness.start(row)
  ↓
defineBenchTask fn(ctx)
  ↓
score + Braintrust metadata + cleanup
```

### Bench planner rules

The planner is responsible for matrix expansion only. It should not start browsers, import Braintrust, or execute tasks.

Inputs:

- discovered bench tasks
- resolved CLI/config options
- model/provider defaults
- dataset/sample/filter selections
- harness selection
- core tool/startup selection

Outputs:

- deterministic `BenchMatrixRow[]`
- warnings for unsupported combinations
- no side effects

Rules:

- If `--model` is passed, use exactly that model.
- If `--model` is omitted, use existing `getModelList(category)` / `getAgentModelEntries()` behavior.
- If `--harness` is omitted, default to `stagehand`.
- `--api` applies only to harnesses that support it. Initially this means `stagehand`.
- If `--tool` is omitted, the selected harness uses its native/default browser tool path.
- If `--tool` is passed, the planner validates that the selected harness can consume that tool surface.
- If a tool surface uses core startup, resolve startup the same way core does.
- Preserve direct-suite env compatibility for `--limit`, `--sample`, and `--filter` until the suite builders accept typed options.

### Bench metadata rules

Every Braintrust testcase created by bench v2 must include:

```typescript
{
  tier: "bench";
  test: row.task;
  model: row.model;
  provider?: row.provider;
  harness: row.harness;
  toolSurface?: row.toolSurface;
  startupProfile?: row.startupProfile;
  environment: row.environment;
  useApi?: row.useApi;
  dataset?: row.dataset;
  category: row.category;
  trial: row.trial;
}
```

This is more important than experiment naming. Names are for humans; metadata is for comparisons.

### Bench v2 migration path

1. Add planner + harness types with `stagehand` only.
2. Route current bench execution through the `stagehand` harness without behavior changes.
3. Add `--harness` parser support, defaulting to `stagehand`.
4. Add metadata for every matrix axis, including `useApi`.
5. Add one external harness spike, likely `claude_code` first because its SDK exposes a documented agent harness and MCP/tooling surface.
6. Add `codex` as a CLI-driven external harness once the browser/tool handoff contract is clear.
7. Move direct suite builders from env-driven options to typed options.

---

## Core contract

### CoreTool

```typescript
interface CoreTool {
  id: ToolSurface;
  surface: "code" | "mcp" | "cli";
  family:
    | "understudy"
    | "playwright"
    | "cdp"
    | "stagehand_cli"
    | "chrome_devtools";

  supportedStartupProfiles: StartupProfile[];
  supportedCapabilities: CoreCapability[];
  supportedTargetKinds: TargetKind[];

  start(input: ToolStartInput): Promise<CoreSession>;
}

type CoreCapability =
  | "session"
  | "navigation"
  | "evaluation"
  | "screenshot"
  | "viewport"
  | "wait"
  | "click"
  | "hover"
  | "scroll"
  | "type"
  | "press"
  | "tabs"
  | "representation";
```

### CoreSession

```typescript
interface CoreSession {
  listPages(): Promise<PageHandle[]>;
  activePage(): Promise<PageHandle>;
  newPage(url?: string): Promise<PageHandle>;
  selectPage(pageId: string): Promise<void>;
  closePage(pageId: string): Promise<void>;
  close(): Promise<void>;
  getArtifacts(): Promise<Artifact[]>;
  getRawMetrics(): Promise<Record<string, unknown>>;
}
```

### PageHandle

```typescript
interface PageHandle {
  readonly id: string;

  // Navigation
  goto(url: string, opts?: NavOpts): Promise<void>;
  reload(opts?: NavOpts): Promise<void>;
  back(opts?: NavOpts): Promise<boolean>;
  forward(opts?: NavOpts): Promise<boolean>;
  goBack(opts?: NavOpts): Promise<boolean>;
  goForward(opts?: NavOpts): Promise<boolean>;

  // Inspection / page-info
  url(): string;
  title(): Promise<string>;
  evaluate<R = unknown, Arg = unknown>(
    pageFunctionOrExpression: string | ((arg: Arg) => R | Promise<R>),
    arg?: Arg,
  ): Promise<R>;
  screenshot(opts?: ScreenshotOpts): Promise<Buffer>;
  setViewport(size: { width: number; height: number }): Promise<void>;
  setViewportSize(width: number, height: number): Promise<void>;
  wait(spec: WaitSpec): Promise<void>;
  waitForSelector(
    selector: string,
    opts?: {
      timeout?: number;
      state?: "attached" | "detached" | "visible" | "hidden";
    },
  ): Promise<boolean>;
  waitForTimeout(ms: number): Promise<void>;
  locator(selector: string): CoreLocatorHandle;

  // Actions — string = selector sugar, object = explicit target
  click(target: string | ActionTarget): Promise<void>;
  click(x: number, y: number): Promise<void>;
  hover(target: string | ActionTarget): Promise<void>;
  hover(x: number, y: number): Promise<void>;
  scroll(x: number, y: number, deltaX: number, deltaY: number): Promise<void>;
  type(text: string): Promise<void>;
  type(
    target: string | ActionTarget | { kind: "focused" },
    text: string,
  ): Promise<void>;
  press(key: string): Promise<void>;
  press(
    target: string | ActionTarget | { kind: "focused" },
    key: string,
  ): Promise<void>;

  // Representation
  represent?(opts?: RepresentationOpts): Promise<PageRepresentation>;
}
```

### ActionTarget

```typescript
type TargetKind =
  | "selector"
  | "coords"
  | "snapshot_ref"
  | "role_name"
  | "text"
  | "focused";

type ActionTarget =
  | { kind: "selector"; value: string }
  | { kind: "coords"; x: number; y: number }
  | { kind: "snapshot_ref"; value: string }
  | { kind: "role_name"; role: string; name?: string }
  | { kind: "text"; text: string };
```

String overloads resolve to `{ kind: "selector", value: str }` inside the adapter. Tasks should use fixture targets by default for target-kind portability.

### PageRepresentation

```typescript
interface PageRepresentation {
  kind: "accessibility_tree" | "snapshot_refs" | "dom_text" | "custom";
  content: string;
  metadata?: {
    refCount?: number;
    nodeCount?: number;
    bytes?: number;
    tokenEstimate?: number;
  };
  raw?: unknown;
}
```

---

## Core categories

| Category                     | Tasks                                                                                          |
| ---------------------------- | ---------------------------------------------------------------------------------------------- |
| **navigation**               | goto, reload, back_forward                                                                     |
| **actions**                  | click, click_coordinates, hover, scroll                                                        |
| **forms**                    | type_input, press_key                                                                          |
| **page-info**                | get_url, get_title, get_text, evaluate_js, wait_for_selector, screenshot                       |
| **tabs**                     | new_tab, switch_tab                                                                            |
| **viewport**                 | set_viewport                                                                                   |
| **representation (planned)** | snapshot_contains_target, snapshot_fidelity, snapshot_actionability, snapshot_token_efficiency |

---

## Metrics

### Execution (all tasks)

- `startup_ms`, `task_ms`, `cleanup_ms`, `total_ms`
- `cold` (boolean)
- `flake_rate` (computed over trials)
- `artifact_bytes`

### Representation (representation tasks)

- `representation_bytes`
- `representation_token_estimate`
- `representation_coverage_score` — was the target element present?
- `representation_fidelity_score` — role/name/text match ground truth?
- `representation_actionability_score` — can refs/selectors drive follow-up action?
- `representation_stability_score` (deferred to v2)

Percentiles (p50, p95) computed at the reporting layer over trials.

### Result shape

```typescript
interface CoreRunResult {
  tool: ToolSurface;
  family: string;
  surface: "code" | "mcp" | "cli";
  startupProfile: StartupProfile;
  environment: EnvironmentName;
  browserOwnership: BrowserOwnership;
  connectionMode: ConnectionMode;
  task: string;
  category: string;
  trial: number;
  cold: boolean;
  success: boolean;
  errorType?: string;
  metrics: {
    /* all metrics above */
  };
  rawMetrics: Record<string, unknown>;
  artifacts: Artifact[];
}
```

---

## Fixture helpers

Lightweight typed constants for eval-site targets. Not a framework — just reuse.

```typescript
export const dropdownFixture = {
  get url() {
    return fixtureUrl("/dropdown", htmlFixtureUrl("dropdown", dropdownHtml));
  },
  selectors: {
    button: "#dropdown-button",
    input: "#fixture-input",
  },
  targets: {
    button: { kind: "selector", value: "#dropdown-button" },
    input: { kind: "selector", value: "#fixture-input" },
  },
  expected: {
    title: "Core Dropdown Fixture",
    buttonText: "Open Menu",
  },
};
```

---

## Task authoring

```typescript
export default defineCoreTask(
  { name: "click", categories: ["actions"], requires: ["navigation", "click"] },
  async ({ page, assert, metrics }) => {
    await page.goto(fixtures.dropdown.url);
    const stop = metrics.startTimer("task_ms");
    await page.click(fixtures.dropdown.targets.button);
    stop();
    assert.equals(
      await page.title(),
      fixtures.dropdown.expected.titleAfterClick,
    );
  },
);
```

Representation task:

```typescript
export default defineCoreTask(
  {
    name: "snapshot_contains_target",
    categories: ["representation"],
    requires: ["navigation", "representation"],
  },
  async ({ page, assert, verifyRepresentation }) => {
    await page.goto(fixtures.dropdown.url);
    const repr = await page.represent?.();
    assert.truthy(repr);
    verifyRepresentation.containsTarget(
      repr!,
      fixtures.dropdown.targets.button,
    );
    verifyRepresentation.fidelity(repr!, fixtures.dropdown.targets.button);
    verifyRepresentation.actionability(repr!, fixtures.dropdown.targets.button);
  },
);
```

---

## Directory layout

```
packages/evals/
  core/                            # Core substrate
    contracts/
      tool.ts                      # CoreTool, CoreSession, PageHandle
      targets.ts                   # ActionTarget, TargetKind
      representation.ts            # PageRepresentation
      results.ts                   # CoreRunResult
    tools/
      understudy_code.ts           # V3 adapter
      playwright_code.ts           # Playwright adapter
      cdp_code.ts                  # direct CDP adapter
      playwright_mcp.ts            # Playwright MCP adapter
      chrome_devtools_mcp.ts       # Chrome DevTools MCP adapter
      browse_cli.ts                # browse CLI adapter
      registry.ts                  # getCoreTool(), list
    runtime/
      coreDeps.ts                  # lazy dependency loading
    targets/
      browserbase.ts               # runner-provided Browserbase target
      localChrome.ts               # runner-provided local Chrome target
      index.ts
    fixtures/
      index.ts
    tasks/
      navigation/
      actions/
      forms/
      page-info/
      tabs/
      viewport/
      representation/              # planned, not landed yet

  framework/                       # Shared utilities (both tiers)
    defineTask.ts
    discovery.ts
    runner.ts
    benchRunner.ts                 # planned: bench v2 planner/executor
    benchHarness.ts                # planned: harness contracts + registry
    assertions.ts
    metrics.ts
    context.ts                     # buildCoreContext() + buildBenchContext()
    types.ts
    index.ts

  tasks/bench/                     # Bench tasks (144, untouched)

  tui/                             # Active CLI/TUI command surface
    commands/
      run.ts
      list.ts
      config.ts
      core.ts
      experiments.ts
      new.ts
      parse.ts
      help.ts
    repl.ts
    progress.ts
    results.ts

  cli.ts                           # Unified entrypoint: argv mode + REPL
  cli-legacy.ts                    # Legacy reference path; not the default
```

Planned bench v2 files:

| File                         | Purpose                                                                 |
| ---------------------------- | ----------------------------------------------------------------------- |
| `framework/benchHarness.ts`  | `BenchHarness`, `Harness`, harness registry                             |
| `framework/benchPlanner.ts`  | Expands tasks + flags into `BenchMatrixRow[]`                           |
| `framework/benchRunner.ts`   | Executes rows, handles scoring/progress/metadata                        |
| `framework/benchSuites.ts`   | Compatibility layer for `webvoyager` and `onlineMind2Web`                     |
| `framework/runner.ts`        | Delegates bench execution to bench v2 once the first slice is ready     |

---

## CLI/TUI command surface

The unified entrypoint is `packages/evals/cli.ts`. It supports argv mode and REPL mode from the same command modules.

### Entry modes

- `evals` starts the REPL.
- `evals <command> ...` runs one command and exits.
- Built output remains `packages/evals/dist/cli/cli.js`.

### Commands

| Command                 | Purpose                                                                        |
| ----------------------- | ------------------------------------------------------------------------------ |
| `run [target] [flags]`  | Run core or bench evals through the unified runner                             |
| `list [core\|bench]`    | List discovered tasks and categories                                           |
| `config`               | Read/write general eval defaults                                               |
| `config core`          | Read/write core tool/startup defaults                                          |
| `experiments`          | Help/overview for Braintrust experiment inspection                             |
| `experiments list`     | Show recent runs from `stagehand-dev` and `stagehand-core-dev`                 |
| `experiments show`     | Show one experiment                                                            |
| `experiments open`     | Open one experiment in the browser                                             |
| `experiments compare`  | Generate comparison reports; `--headless` prints a terminal-friendly summary   |
| `new`                  | Scaffold a task file only                                                      |
| `help` / `-h` / `--help` | Print command help                                                           |

### Run output modes

- `verbose=false` is the default.
- Quiet mode suppresses raw run logs and keeps the live task table bounded for long runs.
- Quiet mode still prints:
  - final result counts
  - by-model summaries
  - experiment name / report pointers when available
- `verbose=true` preserves log visibility, with evals-owned clipping/formatting.
- The evals CLI must not change `packages/core` logging behavior to achieve quiet output.

### Bench runner v2 CLI contract

Bench runner v2 should preserve existing target resolution and flags while adding explicit harness selection.

Existing flags that must keep working:

- `-m, --model`
- `-p, --provider`
- `-e, --env`
- `-t, --trials`
- `-c, --concurrency`
- `--api`
- `--tool`
- `--startup`
- `-l, --limit`
- `-s, --sample`
- `-f, --filter key=value`

New v2 flag:

- `--harness <name>` selects the bench harness. Default is `stagehand`.

Target compatibility:

- `evals run act`
- `evals run extract`
- `evals run observe`
- `evals run agent`
- `evals run dropdown`
- `evals run agent/webvoyager`
- `evals run b:webvoyager`
- `evals run benchmark:webvoyager`

The shorthand targets continue to map to suite-backed `agent/<dataset>` targets and preserve `EVAL_<DATASET>_*` compatibility until the suite builders no longer depend on ambient env.

### Side-effect boundaries

- Help, config, list, dry-run, and experiments overview commands should not eagerly import Braintrust.
- Braintrust is loaded only when a command actually needs execution, telemetry flushing, or experiment API access.
- `new` is intentionally scaffold-only after the demo inline edit flow was removed. A richer task-authoring UX should be redesigned separately.

---

## Braintrust integration

### Projects

| Project | CI               | Dev                  | Contents                         |
| ------- | ---------------- | -------------------- | -------------------------------- |
| Core    | `stagehand-core` | `stagehand-core-dev` | Deterministic tool surface evals |
| Bench   | `stagehand`      | `stagehand-dev`      | LLM agent benchmarks             |

### Traced spans

```
eval span
├── session.startup     # browser target prep + adapter attach/init
├── task                # eval logic
└── cleanup             # session teardown
```

### Experiment naming

Snake-case: `{target}_{env}_{tool?}_{startup?}_{mondd_hhmm}`

Examples:

- `all_local_understudy_code_runner_provided_local_cdp_apr07_2347`
- `navigation_open_local_playwright_code_runner_provided_local_cdp_apr07_2347`

---

## Historical note

Earlier versions of this document tracked the phased rollout of adapter-abstracted core as future work. That rollout is now largely complete, so the old phase plan is no longer a good source of truth.

Use these sections instead:

- the normative contract and matrix definitions above for the intended model
- the appendix below for landed surfaces, startup-profile behavior, MCP implementation rules, and current parity status
- `plan.md` for the remaining execution order and open cleanup work

---

## Key design decisions

1. **Tool surface is the unit under test** — not the library, but the concrete interface (code vs MCP vs CLI)
2. **Directory-based tiers, tag-based cross-cutting categories** — `EXTRA_CATEGORIES` (additive) and `CATEGORY_OVERRIDES` (replacement)
3. **Auto-discovery** — filesystem is source of truth; `evals.config.json` only stores defaults + benchmarks
4. **Config save isolation** — `saveConfig()` strips tasks key
5. **Adapter-agnostic core tasks** — tasks call `PageHandle`, not V3 or Playwright directly
6. **Target-kind union** — `ActionTarget` supports selector, coords, snapshot_ref, role_name, text; string shorthand for selectors
7. **Representation in core** — snapshot/accessibility tasks verified by coverage, fidelity, actionability, efficiency
8. **Startup measured separately** — `session.startup` span isolates browser init variance
9. **Separate Braintrust projects** — core and bench tracked independently
10. **Runner-provided startup for v1** — proves adapter contract without coupling to browser ownership variants
11. **Fixture-first authoring** — tasks use typed fixture targets for portability; raw selectors are the exception
12. **Side-effect-free imports** — lazy validation, no `process.exit` at import time
13. **Dual export support** — `index.eval.ts` handles both `EvalFunction` and `defineBenchTask` exports
14. **Quiet command startup** — non-running CLI commands avoid eager Braintrust imports and optional telemetry warnings
15. **Scaffold-only task creation** — `evals new` creates files; interactive authoring is not part of the current command contract

---

## Appendix: Implemented status notes

This appendix is additive and records what has actually landed so far in the current overhaul branch. It does not replace the earlier phase-oriented sections above.

### Landed surfaces and startup behavior

- Implemented tool surfaces now include:
  - `understudy_code`
  - `playwright_code`
  - `cdp_code`
  - `playwright_mcp`
  - `chrome_devtools_mcp`
  - `browse_cli`
- `browse_cli` now supports:
  - `tool_launch_local` in `LOCAL`
  - `tool_create_browserbase` in `BROWSERBASE`
- Runner-provided Browserbase CDP startup is no longer deferred. It is part of the active core matrix for code and MCP surfaces that support it.

### Fixtures and task source of truth

- Core fixtures are no longer hosted-only. They are served locally when the eval fixture server is present, with inline `data:` fallbacks when it is not.
- Deterministic core tasks live under `packages/evals/core/tasks/`.
- The current code category name is still `page-info`, even though the conceptual category in this spec is `inspection`.

### MCP implementation rule now enforced in code

- The MCP adapters are now implemented as native-tool-first adapters.
- `playwright_mcp` prefers:
  - `browser_tabs`
  - `browser_snapshot`
  - `browser_click`
  - `browser_hover`
  - `browser_type`
  - `browser_press_key`
- `chrome_devtools_mcp` prefers:
  - `list_pages`
  - `take_snapshot`
  - `click`
  - `hover`
  - `fill`
  - `type_text`
  - `press_key`
  - `emulate` for viewport emulation
- Code execution is now reserved for the remaining real gaps, such as:
  - selector-to-ref / selector-to-uid bridging
  - coordinate actions
  - selector waits
  - generic page evaluation
  - Playwright MCP history navigation

### Shared MCP runtime notes

- MCP artifact handling now uses the runtime-managed artifact directory instead of leaving generated files in the repo.
- The MCP runtime no longer forces `XDG_CACHE_HOME` / `PNPM_HOME` to `/tmp`, because that broke Corepack-managed `pnpm` resolution for spawned MCP servers.
- Loose JSON parsing now preserves scalar strings like `"true"` instead of coercing them into booleans. This matters for DOM attribute reads returned through MCP wrappers.

### Current parity snapshot

These are implementation notes, not normative guarantees:

- `playwright_code`, `cdp_code`, and `browse_cli` are proven across the current full core suite in `BROWSERBASE`.
- `browse_cli` is proven across the current full core suite in `LOCAL`.
- `playwright_mcp` is now green across the full one-trial core suite in both `LOCAL` and `BROWSERBASE`.
- `chrome_devtools_mcp` is now green across the full one-trial core suite in both `LOCAL` and `BROWSERBASE`.
- `understudy_code` now uses the real runner-provided attach path for `runner_provided_*_cdp` profiles.
- The only currently known parity gap in the active core matrix is:
  - `understudy_code` Browserbase `navigation/back_forward`

### Additional implementation notes after MCP hardening

- `chrome_devtools_mcp` viewport emulation now uses the native `emulate` tool with a `viewport` payload, rather than `resize_page`, because `resize_page` only changed outer window bounds on Browserbase-attached sessions while leaving `window.innerWidth` unchanged.
- `playwright_mcp` history navigation remains code-tunneled, but now uses a narrower history-navigation path instead of waiting on full Playwright `load` semantics for local back/forward.

### Startup-profile and attach-path notes

- The intended default startup-profile matrix is now:
  - `browse_cli`
    - `LOCAL` → `tool_launch_local`
    - `BROWSERBASE` → `tool_create_browserbase`
  - `understudy_code`
    - `LOCAL` → `runner_provided_local_cdp`
    - `BROWSERBASE` → `runner_provided_browserbase_cdp`
  - `playwright_code`
    - `LOCAL` → `runner_provided_local_cdp`
    - `BROWSERBASE` → `runner_provided_browserbase_cdp`
  - `cdp_code`
    - `LOCAL` → `runner_provided_local_cdp`
    - `BROWSERBASE` → `runner_provided_browserbase_cdp`
  - `playwright_mcp`
    - `LOCAL` → `runner_provided_local_cdp`
    - `BROWSERBASE` → `runner_provided_browserbase_cdp`
  - `chrome_devtools_mcp`
    - `LOCAL` → `runner_provided_local_cdp`
    - `BROWSERBASE` → `runner_provided_browserbase_cdp`
- `understudy_code` runner-provided attach profiles now pass through the actual `cdpUrl` / `cdpHeaders` values into `initV3`, instead of silently dropping them in the eval wrapper.
- For attach-style Understudy eval runs, the eval wrapper now explicitly forces the V3 environment override needed to use the CDP attach path instead of creating a fresh Browserbase session.

### Current CLI/TUI status notes

- The unified CLI/TUI is the active command surface.
- `verbose=false` is the default run presentation.
- `verbose=true` is the explicit log-heavy mode.
- `experiments compare --headless` produces a small terminal-friendly comparison summary while preserving the generated JSON/HTML report files.
- `experiments` with no subcommand prints help/overview, not recent runs.
- `new` no longer starts an inline REPL edit session after scaffolding.
- Invalid `list` filters fail explicitly instead of printing an empty registry.
- Source-mode and built-binary help/dry-run/config/list paths should stay quiet and avoid Braintrust optional telemetry warnings.
