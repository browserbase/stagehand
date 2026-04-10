# Evals Overhaul Plan

## Current State

The core tool-surface substrate is real and exercised.

Landed:

- core contracts under `packages/evals/core/contracts/`
- adapter-aware framework layer under `packages/evals/framework/`
- unified core execution path with Braintrust core project routing
- core scoring uses `Pass` + `Error rate`
- core tracing separates `session.startup`, `task`, and `cleanup`
- core result metrics now include `startup_ms`, `task_ms`, `cleanup_ms`, and `total_ms`
- Braintrust flush is wired at the shared runner layer
- core task source of truth moved to `packages/evals/core/tasks/`
- discovery updated so core resolves only from `core/tasks`
- legacy `tasks/core` path removed
- local core fixtures now run through a tiny localhost server instead of hosted GitHub Pages
- runner-provided browser targets for:
  - `LOCAL`
  - `BROWSERBASE`
- tool surfaces implemented:
  - `understudy_code`
  - `playwright_code`
  - `cdp_code`
  - `playwright_mcp`
  - `chrome_devtools_mcp`
- full current core suite passes in `LOCAL` for:
  - `understudy_code`
  - `playwright_code`
- `navigation/open` smoke passes in `LOCAL` for:
  - `playwright_mcp`
  - `chrome_devtools_mcp`
- experiment naming now includes tool surface and startup profile
- core runs now land in `stagehand-core-dev` / `stagehand-core`
- bench/category runner fixes landed for:
  - direct suite benchmark model selection
  - `--new-runner` CLI parsing
  - bench entrypoint routing
- single-sample metric summaries are intentionally compact again: `{ count, value }`

Important product decisions already made:

- core evaluates **tool surfaces**, not abstract libraries
- startup cost is part of the product and measured separately
- browser target and tool surface are separate axes, but startup ownership remains visible in results
- representation remains part of core conceptually, but is **descoped for this sprint**
- bench should eventually compose on top of the core tool layer instead of inventing a second browser abstraction

## What Changed Since The Original Plan

Completed relative to the earlier plan:

- `cdp_code` is implemented
- initial MCP surfaces are implemented
- runner-provided Browserbase target exists
- core tracing/scoring/reporting cleanup landed

Descoped for this sprint:

- representation task design and implementation

That changes the immediate focus from “prove the abstraction exists” to “remove compatibility debt and harden the newly added surfaces.”

## Active Priorities

### 1. Remove Practical V3 Coupling

- rewrite moved core tasks to use the portable contract directly
- reduce reliance on compatibility-era `CorePageHandle` methods
- keep all new deterministic tasks authored in `packages/evals/core/tasks/`

This is still the highest-value cleanup. The task files moved, but many of them still think in terms of the old page API shape.

### 2. Harden The Implemented Surfaces

- run broader core coverage against:
  - `cdp_code`
  - `playwright_mcp`
  - `chrome_devtools_mcp`
- fix task-level failures and unsupported-capability gaps explicitly
- make capability gaps surface as clear unsupported behavior where needed

Today:

- `understudy_code` and `playwright_code` are the only surfaces proven across the full local core suite
- `playwright_mcp` and `chrome_devtools_mcp` have only been smoke-tested on `navigation/open`
- `cdp_code` exists but still needs parity work on several tasks

### 3. Validate Browserbase End To End

- verify runner-provided Browserbase startup across the implemented tool surfaces
- confirm the MCP surfaces attach cleanly in Browserbase env
- make sure Browserbase metadata stays visible without leaking sensitive config

The Browserbase target exists, but the new MCP surfaces have not been fully validated there yet.

### 4. Clean Up Core Shape

- decide whether `page-info` stays or becomes `inspection`
- keep fixtures lightweight while avoiding hardcoded-target drift
- tighten fixture ergonomics without introducing a heavy fixture runtime
- make category naming and task metadata consistent with the current architecture

### 5. Add The Next Surface

- evaluate whether `browse_cli` is the next best addition after the current surfaces are hardened
- keep WebMCP separate from DevTools MCP if/when it is added later

### 6. Bench Composition Later

- do not let bench drive the immediate cleanup
- once core surfaces are stable, decide whether bench should reuse some multiagent-style runtime ideas
- keep eval semantics in `packages/evals`, even if execution runtime pieces are shared later

## Immediate Sequence

1. Rewrite the moved core tasks against the portable interface.
2. Run and harden `cdp_code` against the full core suite.
3. Run and harden `playwright_mcp` against the full core suite.
4. Run and harden `chrome_devtools_mcp` against the full core suite.
5. Validate the hardened surfaces in `BROWSERBASE`.
6. Then decide whether `browse_cli` is the next surface or whether more cleanup is needed first.

## Deferred

- representation task design and scoring
- fanout UX for running multiple tool surfaces from one command while still producing separate Braintrust experiments
- bench-on-top-of-core composition work
