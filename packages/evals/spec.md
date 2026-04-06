# Evals Overhaul Spec

## Overview

The evals package has been restructured into a 3-tier architecture with auto-discovery, a `defineTask` API, and a core tier runner. Phase 1 is complete. The TUI is built but not yet wired as entrypoint (Phase 2).

---

## Architecture

```
tasks/
├── core/           # Tier 1: deterministic, no-LLM perf tests (18 tasks)
│   ├── navigation/ # open, reload, back_forward
│   ├── actions/    # click, click_coordinates, hover, scroll
│   ├── forms/      # type_input, press_key
│   ├── page-info/  # get_url, get_title, get_text, screenshot, evaluate_js, wait_for_selector
│   ├── viewport/   # set_viewport
│   └── tabs/       # new_tab, switch_tab
└── bench/          # Tier 3: agent benchmarks with LLM evaluators (144 tasks)
    ├── act/         (40 tasks)
    ├── extract/     (25 tasks)
    ├── observe/     (10 tasks)
    ├── combination/ (10 tasks)
    ├── agent/       (46 tasks)
    └── experimental/ (13 tasks)

framework/          # Framework layer
├── types.ts        # Tier, TaskMeta, CoreTaskContext, BenchTaskContext, etc.
├── defineTask.ts   # defineCoreTask(), defineBenchTask()
├── discovery.ts    # Filesystem auto-discovery + resolveTarget()
├── assertions.ts   # Assert helpers for core tier
├── metrics.ts      # Perf metrics collector (timers, p50/p99)
├── context.ts      # Context builders (buildCoreContext, buildBenchContext)
├── runner.ts       # Unified Braintrust runner (multi-tier)
└── index.ts        # Barrel export

tui/                # Phase 2 — built, not yet wired as entrypoint
├── index.ts        # REPL + single-command routing
├── repl.ts         # Interactive REPL
├── format.ts       # ANSI colors (#01C851 brand green)
├── banner.ts       # ASCII art banner
├── progress.ts     # Live progress renderer
├── results.ts      # Results table formatter
└── commands/       # run, list, config, new, help

tests/              # Unit tests (65 tests, all passing)
├── framework/
│   ├── assertions.test.ts
│   ├── metrics.test.ts
│   ├── defineTask.test.ts
│   └── discovery.test.ts
├── taskConfig.test.ts
└── cli.test.ts

runCore.ts          # Core tier entry point (spawned by cli.ts for `evals run core`)
```

### Tier definitions

| Tier | Dir | LLM? | Evaluator? | Model matrix? | Purpose |
|------|-----|------|-----------|--------------|---------|
| **core** | `tasks/core/` | No | No — assertion-based | No — runs once per trial | Deterministic perf tests for browser primitives |
| **interpret** | (future) | Yes | Yes | TBD | AI interpretability of CLI commands |
| **bench** | `tasks/bench/` | Yes | Yes (exactMatch) | Yes — task × model | Agent benchmarks (existing eval suite) |

### Cross-cutting categories (tags, not directories)

`regression`, `targeted_extract`, `external_agent_benchmarks` — tasks live in their natural directory and are tagged via a static `CROSS_CUTTING_CATEGORIES` map in `taskConfig.ts` and `cli.ts`. Commands like `evals run regression` or `evals run targeted_extract` resolve correctly.

### Target resolution

| Command | Behavior |
|---------|----------|
| `evals run` | All bench tasks (default) |
| `evals run core` | All core tier tasks (via `runCore.ts`) |
| `evals run navigation` | Core tier "navigation" category |
| `evals run core:actions` | Tier-qualified category |
| `evals run act` | Bench tier "act" category |
| `evals run regression` | Cross-cutting: all tasks tagged "regression" |
| `evals run dropdown` | Specific task by name |

---

## Phase 1 — Complete

### Task migration (144 bench tasks)
- All tasks moved from `tasks/` and `tasks/agent/` into `tasks/bench/<category>/`
- Import paths updated from `../` to `../../../`
- `evals.config.json` slimmed — `tasks` array removed, only `defaults` + `benchmarks` remain

### Auto-discovery
- `taskConfig.ts` scans `tasks/bench/<category>/` at startup (core excluded from legacy runner)
- `cli.ts` has `discoverTasksFromFS()` with cross-cutting category merging
- `index.eval.ts` has `resolveTaskModulePath()` to find tasks in new directory structure
- `saveConfig()` strips discovered tasks before writing — never persists a stale snapshot
- No manual registration needed — drop a file in the right directory, it's discovered

### Framework layer (`framework/`)
- `types.ts` — `Tier`, `TaskMeta`, `CoreTaskContext`, `BenchTaskContext`, `TaskDefinition`, `DiscoveredTask`, `TaskRegistry`
- `defineTask.ts` — `defineCoreTask()` / `defineBenchTask()` with full type inference
- `discovery.ts` — `discoverTasks()` scans filesystem, `resolveTarget()` handles CLI targeting with ambiguity detection
- `assertions.ts` — `equals`, `matches`, `includes`, `truthy`, `falsy`, `lessThan`, `greaterThan` + `AssertionError`
- `metrics.ts` — `startTimer()`, `record()`, `getSummary()` with min/max/avg/p50/p99
- `context.ts` — `buildCoreContext()` / `buildBenchContext()` wrapping initV3
- `runner.ts` — unified multi-tier Braintrust runner with progress callbacks

### Core tier runner
- `runCore.ts` — standalone entry point spawned by `cli.ts` when target resolves to core tasks
- Runs through Braintrust `Eval()` with assertion-based scoring (no LLM)
- `cli.ts` detects core targets via `CORE_CATEGORIES` set and delegates to `runCoreEntry()`
- `evals list` shows core and bench sections separately

### Core tier tasks (18 tasks, all passing)
| Category | Tasks | APIs tested |
|----------|-------|-------------|
| **navigation** (3) | `open`, `reload`, `back_forward` | goto, reload, goBack, goForward |
| **actions** (4) | `click`, `click_coordinates`, `hover`, `scroll` | locator.click, page.click(x,y), hover(x,y), scroll(x,y,dX,dY) |
| **forms** (2) | `type_input`, `press_key` | locator.fill, page.type |
| **page-info** (6) | `get_url`, `get_title`, `get_text`, `screenshot`, `evaluate_js`, `wait_for_selector` | url(), title(), textContent(), screenshot(), evaluate(), waitForSelector() |
| **viewport** (1) | `set_viewport` | setViewportSize |
| **tabs** (2) | `new_tab`, `switch_tab` | context.newPage(), multi-page verification |

### Side-effect fixes
- `taskConfig.ts` no longer imports `args.ts` (removed import-time `process.exit`)
- `index.eval.ts` calls `validateEvalName()` lazily
- Config save strips `tasks` key — never persists discovered tasks back to config file

### Unit tests (65 tests across 6 files)
- `tests/framework/assertions.test.ts` — all assert helpers + error shape
- `tests/framework/metrics.test.ts` — record, timers, percentiles, summary
- `tests/framework/defineTask.test.ts` — marker, meta passthrough, both variants
- `tests/framework/discovery.test.ts` — filesystem discovery, target resolution, ambiguity, edge cases
- `tests/taskConfig.test.ts` — cross-cutting categories, core exclusion, model lists, validation
- `tests/cli.test.ts` — CLI subprocess tests: help, list, config, run validation

### Build & turbo
- `turbo.json`: `build:cli` inputs include `framework/**`
- Legacy `cli.ts` remains the entrypoint (`"evals": "./dist/cli/cli.js"`)
- `pnpm build:cli` and `pnpm build` both work correctly

### Files modified (from original codebase)
- `packages/evals/cli.ts` — `discoverTasksFromFS()`, `CROSS_CUTTING_CATEGORIES`, `runCoreEntry()`, core-aware `handleList`
- `packages/evals/index.eval.ts` — `resolveTaskModulePath()`, lazy `validateEvalName()`
- `packages/evals/taskConfig.ts` — filesystem discovery, `CROSS_CUTTING_CATEGORIES`, `validateEvalName()` export
- `packages/evals/evals.config.json` — removed `tasks` array
- `turbo.json` — added `framework/**` to `build:cli` inputs

---

## Phase 2 — TUI (built, not active)

The TUI code exists in `tui/` but is **not the CLI entrypoint**. The legacy `cli.ts` → `dist/cli/cli.js` remains the active binary.

### What was built

- REPL mode (readline-based, command dispatch, tokenizer)
- Single-command mode (`evals run`, `evals list`, `evals config`, `evals new`)
- ANSI formatting with #01C851 brand green
- ASCII art "EVALS" banner (block-letter style matching agents dev-cli)
- Live progress renderer (streaming pass/fail per task)
- Results table formatter (by task, by model)
- Subcommand `--help`/`-h` for `run`, `list`, `new`, `config`
- `evals new <tier> <category> <name>` scaffold command
- Path resolution via `getPackageRootDir()` (works from both source and dist)

### To activate

1. Update `package.json` bin: `"evals": "./dist/cli/tui.js"`
2. Add TUI build step to `scripts/build-cli.ts`
3. Add `tui/**` to `turbo.json` `build:cli` inputs
4. Test all legacy CLI workflows through the TUI

### Remaining TUI work

- Ensure `evals config set/reset/path` subcommands work through TUI
- Handle benchmark-specific options (`-l`, `-s`, `-f`, `--dataset`)
- Wire `evals run` TUI to pass `--api`, `--provider` through to runner
- REPL `results` command to show last run
- Support `b:<benchmark>` / `benchmark:<name>` syntax
- Integrate legacy CLI's detailed help (`-man`) content

---

## Future work

### `defineBenchTask` migration (optional, gradual)
Existing 144 bench tasks use the legacy `EvalFunction` export pattern. They can be gradually migrated to `defineBenchTask()` for reduced boilerplate, but the framework supports both patterns indefinitely.

### Tier 2: interpret (not started)
AI interpretability of CLI commands by coding agents. Architecture accommodates this — would add `tasks/interpret/` directory and a new context type.

---

## Key design decisions

1. **Directory-based tiers, tag-based cross-cutting categories** — tasks live in one directory (primary category), cross-cutting tags preserved via static `CROSS_CUTTING_CATEGORIES` map
2. **Auto-discovery over config registration** — `evals.config.json` no longer lists tasks; filesystem is the source of truth; config only stores defaults + benchmark settings
3. **Config save isolation** — `saveConfig()` strips the `tasks` key before writing, preventing stale snapshots from defeating auto-discovery
4. **Core tasks hidden from legacy runner** — `taskConfig.ts` only scans `tasks/bench/`, not `tasks/core/`; core tasks run via separate `runCore.ts` entry point
5. **Backward-compatible** — legacy `EvalFunction` exports still work; `index.eval.ts` searches both old flat and new nested paths
6. **Package root resolution** — TUI uses `getPackageRootDir()`; CLI uses `path.resolve(moduleDir, "../..")` fallback from dist
7. **Side-effect-free imports** — `taskConfig.ts` no longer triggers `process.exit` at import time; validation is lazy
