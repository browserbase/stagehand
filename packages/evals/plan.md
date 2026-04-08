# Evals Overhaul Plan

## Current State

The core adapter substrate is in place.

Landed:

- core contracts under `packages/evals/core/contracts/`
- first tool surface: `understudy_code`
- second tool surface: `playwright_code`
- adapter-aware framework layer under `packages/evals/framework/`
- core task source of truth moved to `packages/evals/core/tasks/`
- discovery updated so core resolves from `core/tasks`
- legacy `tasks/core` path removed
- discovery tests covering core-task resolution and short-name lookup
- local core fixtures now run through a tiny localhost server instead of hosted GitHub Pages
- full current core suite passes in `LOCAL` for both `understudy_code` and `playwright_code`

The adapter contract has now been proven once. The next work is about removing compatibility debt and broadening the surface area, not proving whether the basic abstraction is viable.

## Active Priorities

### 1. Remove Practical V3 Coupling

- rewrite moved core tasks to use the portable contract directly
- reduce reliance on temporary compatibility methods on `CorePageHandle`
- keep all new deterministic tasks authored in `packages/evals/core/tasks/`

The files are in the right place, but many tasks still think in terms of the old page API.

### 2. Add Representation Evaluation

- add representation-focused core tasks
- verify coverage, fidelity, and actionability, not just bytes/tokens
- compare representation latency and payload size alongside action primitives

Representation is part of the core tool offering and should be evaluated in the same core layer.

### 3. Expand Tool Surfaces

- implement `cdp_code`
- then decide ordering for `playwright_mcp`, `chrome_devtools_mcp`, and `browse_cli`
- make unsupported-capability behavior explicit per surface

`understudy_code` and `playwright_code` exist today. `cdp_code` is the next useful pressure test.

### 4. Finish Startup / Environment Modeling

- validate runner-provided startup across `LOCAL` and `BROWSERBASE`
- decide when to add tool-owned startup profiles
- capture browser ownership and connection mode consistently in results

This should stay behind the basic portable-task cleanup.

### 5. Clean Up Core Shape

- decide whether `page-info` stays or becomes `inspection`
- keep fixtures lightweight while avoiding hardcoded-target drift
- add `representation` as an explicit core task category

### 6. Bench Later

- do not let bench drive the immediate migration
- once core is stable, make bench compose on top of the core tool layer instead of defining a parallel abstraction

## Immediate Sequence

1. Rewrite the moved core tasks against the portable interface.
2. Add the first deterministic representation tasks and verifiers.
3. Expand into `cdp_code`.
4. Then evaluate ordering for CLI/MCP surfaces.
