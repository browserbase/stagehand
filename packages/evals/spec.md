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
type ConnectionMode = "launch" | "attach_ws" | "attach_http" | "browserbase_native";
```

---

## Core contract

### CoreTool

```typescript
interface CoreTool {
  id: ToolSurface;
  surface: "code" | "mcp" | "cli";
  family: "understudy" | "playwright" | "cdp" | "stagehand_cli" | "chrome_devtools";

  supportedStartupProfiles: StartupProfile[];
  supportedCapabilities: CoreCapability[];
  supportedTargetKinds: TargetKind[];

  start(input: ToolStartInput): Promise<CoreSession>;
}

type CoreCapability =
  | "session" | "navigation" | "evaluation" | "screenshot"
  | "viewport" | "wait" | "click" | "hover" | "type"
  | "press" | "tabs" | "representation";
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
  // Navigation
  goto(url: string, opts?: NavOpts): Promise<void>;
  reload(opts?: NavOpts): Promise<void>;
  back(opts?: NavOpts): Promise<boolean>;
  forward(opts?: NavOpts): Promise<boolean>;

  // Inspection
  url(): Promise<string>;
  title(): Promise<string>;
  evaluate<T>(expression: string): Promise<T>;
  screenshot(opts?: ScreenshotOpts): Promise<Buffer>;
  setViewport(size: { width: number; height: number }): Promise<void>;
  wait(spec: WaitSpec): Promise<void>;

  // Actions — string = selector sugar, object = explicit target
  click(target: string | ActionTarget): Promise<void>;
  hover(target: string | ActionTarget): Promise<void>;
  type(target: string | ActionTarget | { kind: "focused" }, text: string): Promise<void>;
  press(target: string | ActionTarget | { kind: "focused" }, key: string): Promise<void>;

  // Representation
  represent?(opts?: RepresentationOpts): Promise<PageRepresentation>;
}
```

### ActionTarget

```typescript
type TargetKind = "selector" | "coords" | "snapshot_ref" | "role_name" | "text" | "focused";

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

| Category | Tasks |
|----------|-------|
| **session** | startup, attach_existing, cleanup |
| **navigation** | goto, reload, back_forward |
| **actions** | click, click_coordinates, hover, scroll |
| **forms** | type_input, press_key |
| **inspection** | get_url, get_title, get_text, evaluate_js, wait_for_selector, screenshot, set_viewport |
| **tabs** | new_tab, switch_tab |
| **representation** | snapshot_contains_target, snapshot_fidelity, snapshot_actionability, snapshot_token_efficiency |

---

## Metrics

### Execution (all tasks)

- `startup_ms`, `command_ms`, `cleanup_ms`, `total_ms`
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
  metrics: { /* all metrics above */ };
  rawMetrics: Record<string, unknown>;
  artifacts: Artifact[];
}
```

---

## Fixture helpers

Lightweight typed constants for eval-site targets. Not a framework — just reuse.

```typescript
export const dropdownFixture = {
  url: "https://browserbase.github.io/stagehand-eval-sites/sites/dropdown/",
  targets: {
    button: { selector: "xpath=/html/body/div/div/button", text: "Select..." },
    input: { selector: "xpath=/html/body/div/input" },
  },
  expected: { titleAfterClick: "..." },
};
```

---

## Task authoring

```typescript
export default defineCoreTask(
  { name: "click", categories: ["actions"], requires: ["navigation", "click"] },
  async ({ page, assert, metrics }) => {
    await page.goto(fixtures.dropdown.url);
    const stop = metrics.startTimer("command_ms");
    await page.click(fixtures.dropdown.targets.button);
    stop();
    assert.equals(await page.title(), fixtures.dropdown.expected.titleAfterClick);
  },
);
```

Representation task:

```typescript
export default defineCoreTask(
  { name: "snapshot_contains_target", categories: ["representation"], requires: ["navigation", "representation"] },
  async ({ page, assert, verifyRepresentation }) => {
    await page.goto(fixtures.dropdown.url);
    const repr = await page.represent?.();
    assert.truthy(repr);
    verifyRepresentation.containsTarget(repr!, fixtures.dropdown.targets.button);
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
      startup.ts                   # StartupProfile, ToolStartInput
    tools/
      understudy_code.ts           # V3 adapter
      playwright_code.ts           # Playwright adapter
      registry.ts                  # getAdapter(), listAdapters()
    startup/
      runner_provided_local.ts
      runner_provided_bb.ts
    fixtures/
      dropdown.ts
      resistor.ts
      index.ts
    verifier/
      representation.ts            # coverage, fidelity, actionability
    tasks/
      session/
      navigation/
      actions/
      forms/
      inspection/
      tabs/
      representation/

  framework/                       # Shared utilities (both tiers)
    defineTask.ts
    discovery.ts
    runner.ts
    assertions.ts
    metrics.ts
    context.ts                     # buildBenchContext() only
    types.ts
    index.ts

  tasks/bench/                     # Bench tasks (144, untouched)

  tui/                             # TUI (built, not active)
  runCore.ts                       # Core entry point
  runBench.ts                      # Bench entry point (new runner)
```

---

## Braintrust integration

### Projects

| Project | CI | Dev | Contents |
|---------|-----|-----|----------|
| Core | `stagehand-core` | `stagehand-core-dev` | Deterministic tool surface evals |
| Bench | `stagehand` | `stagehand-dev` | LLM agent benchmarks |

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

## What's been implemented (Phase 1)

### Infrastructure
- Filesystem auto-discovery (`framework/discovery.ts`) — scans `tasks/bench/` and `core/tasks/`
- `defineCoreTask()` / `defineBenchTask()` with full type inference
- `resolveTarget()` with tier:category, category, task name, and ambiguity detection
- Assertions (equals, matches, includes, truthy, falsy, lessThan, greaterThan)
- Metrics (startTimer, record, getSummary — single values emit `{value, count}`, multiple emit full stats)
- Braintrust `traced()` spans for session.startup/task/cleanup
- Separate Braintrust projects per tier
- `eval-summary.json` fallback output

### Bench tier
- 144 tasks migrated to `tasks/bench/<category>/` with `defineBenchTask()` exports
- `index.eval.ts` handles both legacy named exports and `defineBenchTask` default exports
- `runBench.ts` entry point using `framework/runner.ts` (via `--new-runner` flag)
- Cross-cutting categories via `EXTRA_CATEGORIES` (additive) and `CATEGORY_OVERRIDES` (replacement)
- External benchmark suites isolated from `agent` category
- Dead categories removed (`llm_clients`, `regression_llm_providers`)

### Core tier
- 18 tasks across 6 categories, all passing under both `understudy_code` and `playwright_code`
- `runCore.ts` delegates to the shared framework runner with `stagehand-core[-dev]` project
- `LOCAL` core uses a runner-provided Chrome CDP target by default
- CLI detects core targets via `CORE_CATEGORIES` + `coreTaskNames` sets
- Individual core tasks runnable by name (`evals run open`)

### CLI
- Legacy `cli.ts` remains entrypoint (`dist/cli/cli.js`)
- `evals list` shows core and bench separately
- `--new-runner` flag for bench runner migration
- Config save strips discovered tasks (no stale snapshots)

### TUI (built, not active)
- REPL + single-command mode
- ANSI formatting (#01C851 brand green), ASCII banner
- Live progress, results table, subcommand help
- `evals new <tier> <category> <name>` scaffold
- Activation: update bin to `tui.js`, add build step, add `tui/**` to turbo inputs

### Tests
- 76 unit + integration tests across 8 files
- Framework: assertions, metrics, defineTask, discovery, runner logic
- CLI: subprocess tests for help, list, config, run validation
- Integration: runner parity, core routing

### Build
- `turbo.json`: `build:cli` inputs include `framework/**`
- `pnpm build:cli` and `pnpm build` both work

---

## Next: Adapter-abstracted core (v1)

### Scope

| Item | Choice |
|------|--------|
| Adapters | `understudy_code` + `playwright_code` |
| Startup profiles | `LOCAL` uses runner-provided CDP by default (`runner_provided_local_cdp`). Browserbase runner-provided CDP still deferred. |
| Fixtures | Lightweight local core fixtures served over localhost in `LOCAL` |
| Representation tasks | `snapshot_contains_target`, `snapshot_fidelity`, `snapshot_actionability`, `snapshot_token_efficiency` |
| Target syntax | Overloaded — string selector sugar + explicit `ActionTarget` objects. Tasks use fixtures by default. |
| Task migration | Batch migrate all 18 existing core tasks |
| `core/` structure | Core contracts/tools/targets/fixtures live under `core/`; shared execution still lives in `framework/` |

### Implementation order

1. **Contracts** — `core/contracts/` with `CoreTool`, `CoreSession`, `PageHandle`, `ActionTarget`, `StartupProfile`, `PageRepresentation`, `CoreRunResult`
2. **Understudy adapter** — `core/tools/understudy_code.ts` wrapping V3
3. **Fixtures** — `core/fixtures/` for dropdown and resistor eval sites
4. **Update framework** — `CoreTaskContext` gets `tool`/`page` (PageHandle), `adapter` metadata, `startupProfile`; discovery scans `core/tasks/`; remove `buildCoreContext()`
5. **Update runner** — `executeCoreTask()` selects adapter, calls `adapter.start()`, builds context
6. **Batch migrate 18 tasks** — `tasks/core/` → `core/tasks/`, rewrite to use `PageHandle` + fixtures
7. **Verify understudy_code** — all tasks pass, functionally identical to Phase 1
8. **Playwright adapter** — `core/tools/playwright_code.ts`
9. **Verify playwright_code** — same tasks pass
10. **Representation tasks + verifiers** — `core/tasks/representation/` + `core/verifier/representation.ts`
11. **CLI wiring** — `--tool` flag, `EVAL_TOOL_SURFACE` env var, adapter in Braintrust metadata
12. **Comparison run** — both adapters on same tasks, compare in Braintrust

### Not in v1

- `cdp_code`, `browse_cli`, `playwright_mcp`, `chrome_devtools_mcp`
- Tool-native startup profiles
- `snapshot_stability_static_page`, `snapshot_frame_shadow_coverage`
- Bench composing on top of core adapters
- TUI activation
- Custom fixture pages
- Publishable standalone package

---

## Future work

### Adapter expansion
- `cdp_code` (Phase 2)
- `browse_cli`, `playwright_mcp`, `chrome_devtools_mcp` (Phase 3)

### Tool-native startup profiles
Once contract is stable, add `tool_launch_local`, `tool_create_browserbase`, etc.

### Bench on core adapters
Bench should eventually compose on top: `model × harness × tool_surface × startup_profile × task × trial`

### Tier 2: interpret
AI interpretability of CLI commands by coding agents.

### TUI activation
Code exists in `tui/`, needs polish and wiring.

### Publishable standalone
Main blockers: `runtimePaths.ts` monorepo layout, `workspace:*` dependency, source `.ts` at runtime.

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
