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
- `browse_cli`
- full current core suite passes in `LOCAL` for:
  - `understudy_code`
  - `playwright_code`
  - `browse_cli`
  - `chrome_devtools_mcp`
- full current core suite passes in `BROWSERBASE` for:
  - `playwright_code`
  - `cdp_code`
  - `browse_cli`
  - `playwright_mcp`
- one-trial current core suite passes in `BROWSERBASE` for:
  - `playwright_mcp`
- one-trial current core suite passes in `LOCAL` for:
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

That changes the immediate focus from “prove the abstraction exists” to “close the last real parity gaps, then bring the docs/spec back in line with the implementation and return representation to scope.”

## Active Priorities

### 1. Close The Remaining Real Parity Gaps

- fix the remaining real failures:
  - `understudy_code`: flaky `navigation/back_forward` in `BROWSERBASE`
  - `playwright_mcp`: `navigation/back_forward` in `LOCAL`
  - `chrome_devtools_mcp`: `viewport/set_viewport` in `BROWSERBASE`
- keep these fixes inside the actual tool surfaces or runtimes, not the eval adapters
- continue validating with full core-suite runs in both `LOCAL` and `BROWSERBASE`

This is now the highest-value work. The MCP adapters are thin enough that the remaining failures are product signals or runtime semantics, not scaffolding debt.

### 2. Keep The Core Contract Honest

- keep deterministic tasks authored only in `packages/evals/core/tasks/`
- avoid adding adapter-only healing or retries that would distort tool-surface comparisons
- keep startup ownership visible in results:
  - runner-provided CDP where the runner owns the browser
  - native tool-owned startup where the surface owns the browser (`browse_cli`, Understudy local launch, etc.)

Today:

- `browse_cli` is now proven across the full core suite in both `LOCAL` and `BROWSERBASE`
- `playwright_code` and `cdp_code` are proven in `BROWSERBASE`
- `playwright_mcp` is now proven across the one-trial full core suite in `BROWSERBASE`
- `chrome_devtools_mcp` is now proven across the full core suite in `LOCAL`
- the remaining parity gaps are concentrated in `understudy_code`, `playwright_mcp` local history navigation, and `chrome_devtools_mcp` Browserbase viewport sizing

### 3. Reconcile Spec And Current Core Shape

- decide whether the category should be renamed from `page-info` to `inspection` to match the spec, or whether the spec should explicitly note the current code name
- document the intended startup-profile matrix per tool surface now that `browse_cli` supports native Browserbase creation
- document the MCP implementation rule that native tool calls are preferred over code tunneling
- decide whether the spec should stay slightly idealized or be updated to reflect the current `CorePageHandle` shape exactly

The biggest spec drift today is not architectural; it is naming and documentation shape.

### 4. Bring Representation Back Into Scope

- representation is explicitly part of core in `spec.md`
- the contract already supports `represent()`, `PageRepresentation`, refs, and representation metrics
- what is missing is the actual deterministic representation task set and scoring harness:
  - `snapshot_contains_target`
  - `snapshot_fidelity`
  - `snapshot_actionability`
  - `snapshot_token_efficiency`

This should come back once the remaining remote parity issues are closed.

### 5. Decide Whether Another Surface Is Worth It Yet

- `browse_cli` is no longer the next surface; it is landed
- keep WebMCP separate from DevTools MCP if/when it is added later
- do not add another surface until the current Browserbase parity issues are no longer noisy

### 6. Bench Composition Later

- do not let bench drive the immediate cleanup
- once core surfaces are stable, decide whether bench should reuse some multiagent-style runtime ideas
- keep eval semantics in `packages/evals`, even if execution runtime pieces are shared later

## Immediate Sequence

1. Fix `playwright_mcp` local `navigation/back_forward`.
2. Fix `chrome_devtools_mcp` Browserbase `viewport/set_viewport`.
3. Investigate and fix the real `understudy_code` Browserbase `navigation/back_forward` failure in Understudy core, not in the eval adapter.
4. Reconcile spec naming/docs:
   - `inspection` vs `page-info`
   - startup-profile matrix by surface
   - native-first MCP adapter rule
   - any remaining contract-shape drift worth fixing now
5. Start the representation task/scoring pass described in `spec.md`.

## Deferred

- representation task design and scoring
- fanout UX for running multiple tool surfaces from one command while still producing separate Braintrust experiments
- bench-on-top-of-core composition work
