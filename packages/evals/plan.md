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
- one-trial current core suite passes in `LOCAL` for:
  - `playwright_mcp`
- full current core suite passes in `BROWSERBASE` for:
  - `playwright_code`
  - `cdp_code`
  - `browse_cli`
- one-trial current core suite passes in `BROWSERBASE` for:
  - `playwright_mcp`
  - `chrome_devtools_mcp`
- experiment naming now includes tool surface and startup profile
- core runs now land in `stagehand-core-dev` / `stagehand-core`
- bench/category runner fixes landed for:
  - direct suite benchmark model selection
  - unified CLI entrypoint routing
  - `--legacy` escape-hatch routing
- single-sample metric summaries are intentionally compact again: `{ count, value }`
- unified CLI/TUI is now the active command surface for:
  - REPL mode
  - `run`
  - `list`
  - `config`
  - `config core`
  - `experiments`
  - `new`
- default run output is quiet and bounded with `verbose=false`
- verbose mode keeps eval-owned log clipping without changing `packages/core`
- quiet/help/dry-run commands avoid eager Braintrust imports in both source and built CLI modes
- `experiments compare --headless` exists for terminal-friendly comparison summaries backed by the JSON report output
- `new` is scaffold-only again; the demo inline REPL edit flow was removed
- bench runner v2 has named harnesses:
  - `stagehand` is the default behavior-preserving harness
  - `claude_code` is executable through the Claude Code SDK with `browse_cli`
  - `codex` remains planned/dry-run-only
- Claude Code execution no longer requires `EVAL_CLAUDE_CODE_EXPERIMENTAL=true`
- Claude Code max-turn stops now return normal task results/artifacts instead of generic harness exceptions

Important product decisions already made:

- core evaluates **tool surfaces**, not abstract libraries
- startup cost is part of the product and measured separately
- browser target and tool surface are separate axes, but startup ownership remains visible in results
- representation remains part of core conceptually, but is **not the next implementation step**
- bench should eventually compose on top of the core tool layer instead of inventing a second browser abstraction

## What Changed Since The Original Plan

Completed relative to the earlier plan:

- `cdp_code` is implemented
- initial MCP surfaces are implemented
- runner-provided Browserbase target exists
- core tracing/scoring/reporting cleanup landed
- unified CLI/TUI wiring landed
- TUI quiet/verbose behavior landed
- `experiments` command landed
- `new` command was simplified back to scaffold-only

Deferred until after the bench runner v2 spike:

- representation task design and implementation
- shared external-harness evaluator parity for active agent benchmarks

That changes the immediate focus from “prove the abstraction exists” to “make external harness results comparable without regressing the current Stagehand benchmark path.”

## Active Priorities

### 1. Record The Remaining Real Parity Gap

- known remaining real failure:
  - `understudy_code`: flaky `navigation/back_forward` in `BROWSERBASE`
- do not add eval-adapter retries or task-specific healing for this gap
- when this is picked back up, keep the fix inside Understudy/core runtime behavior, not in the eval harness

This remains the only meaningful parity noise in the active core matrix, but it is intentionally skipped for the next pass so we can finish the smaller cleanup items before bench runner v2 planning.

### 2. Keep The Core Contract Honest

- keep deterministic tasks authored only in `packages/evals/core/tasks/`
- avoid adding adapter-only healing or retries that would distort tool-surface comparisons
- keep startup ownership visible in results:
  - runner-provided CDP where the runner owns the browser
  - native tool-owned startup where the surface owns the browser (`browse_cli`, Understudy local launch, etc.)

Today:

- `browse_cli` is now proven across the full core suite in both `LOCAL` and `BROWSERBASE`
- `playwright_code` and `cdp_code` are proven in `BROWSERBASE`
- `playwright_mcp` is now proven across the one-trial full core suite in both `LOCAL` and `BROWSERBASE`
- `chrome_devtools_mcp` is now proven across the one-trial full core suite in both `LOCAL` and `BROWSERBASE`
- `understudy_code` now uses the real runner-provided attach path for `runner_provided_*_cdp` profiles instead of silently creating its own Browserbase session
- the only remaining known parity gap is `understudy_code` Browserbase `navigation/back_forward`

### 3. Reconcile Spec And Current Core Shape

- keep the current code/category naming note explicit:
  - code still uses `page-info`
  - spec still describes the conceptual bucket as `inspection`
- keep the startup-profile matrix per tool surface documented
- keep the MCP implementation rule explicit:
  - native tool calls first
  - code tunneling only for real surface gaps
- decide whether the spec should stay slightly idealized or be updated to reflect the current `CorePageHandle` shape exactly

Most of this reconciliation is now reflected in the additive appendix of `spec.md`. The remaining decision is whether to rename `page-info` in code or keep the note as a permanent terminology bridge.

### 4. Keep The New TUI Surface Stable

The unified CLI/TUI is now the entrypoint users hit first. The first hardening pass is complete enough to unblock bench runner v2 planning. Keep this surface stable while bench planning happens.

Completed in the hardening pass:

- source-mode and built-binary parity checked for:
  - `evals`
  - `evals run ... --dry-run`
  - `evals list`
  - `evals config`
  - `evals config core`
  - `evals experiments`
  - `evals new`
- demo-only inline REPL edit behavior in `new` removed
- help text aligned with the current command surface
- `verbose=false` quiet-mode output bounded for long runs
- duplicate final task/model/result table suppressed in quiet mode
- `verbose=true` log clipping remains evals-owned; no `packages/core` changes
- Braintrust imports deferred so help/config/list/dry-run commands stay quiet
- invalid `list` filters now fail explicitly

Remaining TUI follow-ups that should not block bench runner v2 planning:

- decide whether `new` should stay a minimal scaffold command or become a separate guided task authoring flow later
- add a small CLI smoke script if repeated manual checks become costly
- keep an eye on Braintrust rate limits in `experiments list` and add batching/backoff only if it remains noisy in daily use

### 5. Bench Runner V2 Proposal

Bench runner v2 is the next major project. The proposal below is the implementation target because it changes the evaluation matrix:

```
model × harness × tool_surface × startup_profile × benchmark_task × trial
```

Planning questions to resolve:

- what a `harness` is as a first-class type
- how bench tasks receive a core-backed browser/tool context without becoming core tasks
- how model selection composes with tool-surface selection
- how Braintrust experiment naming distinguishes model, harness, tool, startup, and dataset
- how active benchmark suites (`webvoyager`, `onlineMind2Web`) move onto the new shape
- what remains V3-specific and what should reuse core `CoreTool` / `CoreSession` / `CorePageHandle`
- how to preserve existing benchmark shorthand UX while routing through the new matrix
- how to report failures when either the model layer or the tool/harness layer fails
- whether each matrix point should be its own Braintrust experiment or whether related axes should be grouped

Proposal:

- introduce `Harness` as the missing bench axis
- define a harness as the agent implementation/orchestrator being evaluated, not runtime plumbing
- keep `defineBenchTask` source-compatible for the first implementation slice
- route the current runner path through a `stagehand` harness first
- keep Stagehand local and Stagehand API as the same harness; `--api` remains run config/metadata
- add external harnesses after the current path is represented cleanly
- keep active direct suite shorthands (`b:webvoyager`, `benchmark:onlineMind2Web`) working while gradually removing env-only suite controls

Proposed harnesses:

- `stagehand`
  - current behavior
  - uses `initV3`
  - local and API-backed Stagehand are both this harness
  - task context stays `{ v3, agent, page, logger, input, modelName, debugUrl, sessionUrl }`
- `claude_code`
  - Claude Code / Claude Code SDK agent harness
  - useful because the SDK exposes a documented agent harness with tools, permissions, sessions, and MCP
- `codex`
  - OpenAI Codex agent harness
  - initially likely CLI-driven; evaluate once browser/tool handoff is clear

Optional later harness candidates, not part of the initial contract:

- `opencode`
- `hermes`
- `openclaw`

Research takeaways:

- Claude Code SDK is built on the agent harness that powers Claude Code and exposes headless/TypeScript/Python usage plus tool permissions and MCP extensibility.
- Codex is a concrete coding agent available through local CLI/IDE/cloud surfaces; the CLI has approval modes and local file/command execution semantics.

Execution model:

1. CLI resolves target + flags into a bench run request.
2. Discovery resolves bench tasks exactly as today.
3. The bench planner expands tasks into matrix rows:
   - model
   - provider
   - harness
   - tool surface
   - startup profile
   - environment
   - task
   - trial
   - dataset/sample/filter, if applicable
4. Runner executes each row by:
   - resolving model client/API credentials
   - starting the selected harness
   - invoking the existing task function with a compatibility context
   - scoring and recording metadata
   - cleaning up the harness/session
5. Braintrust metadata carries every axis so comparisons can group by model, harness, tool, startup, or dataset.

Braintrust naming rule:

- Keep one experiment per logical CLI run for v2 slice one.
- Include the high-signal axes in the experiment name when they are singular:
  - target
  - env
  - harness
  - tool
  - startup
  - model when only one model is selected
- Put the complete matrix row in metadata for every testcase.

Example names:

- `act_browserbase_stagehand_gpt_4_1_mini_apr27_1530`
- `observe_local_stagehand_playwright_code_runner_provided_local_cdp_apr27_1530`
- `webvoyager_browserbase_stagehand_api_openai_gpt_4_1_mini_apr27_1530`
- `observe_local_claude_code_playwright_code_runner_provided_local_cdp_apr27_1530`

First implementation slice:

- category: `observe`
- models: one explicit `--model`
- harnesses:
  - `stagehand`
- tool surfaces:
  - default current Stagehand path
- environment:
  - start with `LOCAL`
- output:
  - same quiet/verbose progress behavior
  - metadata includes all matrix axes
  - `experiments compare --headless` can compare resulting experiments without special cases

Second slice:

- external harness: `claude_code`
- category: active agent benchmark suites
- tool surface:
  - `browse_cli` first
- goal:
  - prove the harness abstraction compares Stagehand against a genuinely different agent implementation, not a Stagehand runtime variant

Current status:

- `claude_code` is no longer env-gated
- `claude_code + browse_cli` is the first executable external-harness path
- remaining parity gap: `webvoyager`, `onlineMind2Web`, and `webtailbench` need evals-owned shared evaluators so Stagehand and external harness artifacts are judged through the same dataset logic

Non-goals for the first slice:

- rewriting existing bench tasks
- adding representation tasks
- porting all direct suites at once
- fanout UX for multiple models/tools from one CLI command
- replacing `initV3` internals
- removing env compatibility from suite builders
- wiring Codex before the Claude Code harness shape is understood

### 6. Bring Representation Back Into Scope

- representation is explicitly part of core in `spec.md`
- the contract already supports `represent()`, `PageRepresentation`, refs, and representation metrics
- what is missing is the actual deterministic representation task set and scoring harness:
  - `snapshot_contains_target`
  - `snapshot_fidelity`
  - `snapshot_actionability`
  - `snapshot_token_efficiency`

This should come back after the first bench runner v2 slice proves the harness abstraction. It should not be started opportunistically while bench runner requirements are still unsettled.

### 7. Decide Whether Another Surface Is Worth It Yet

- `browse_cli` is no longer the next surface; it is landed
- keep WebMCP separate from DevTools MCP if/when it is added later
- do not add another surface until the current Browserbase parity issues are no longer noisy

### 8. Bench Composition Later

- do not let bench drive the immediate cleanup
- once core surfaces are stable, decide whether bench should reuse some multiagent-style runtime ideas
- keep eval semantics in `packages/evals`, even if execution runtime pieces are shared later

## Immediate Sequence

1. Keep the `understudy_code` Browserbase `navigation/back_forward` failure documented as a known gap; do not patch around it in evals.
2. Treat the current TUI surface as stable enough for the next phase:
   - `verbose=false` remains the default
   - `verbose=true` preserves clipped logs
   - `experiments compare --headless` stays
   - `new` stays scaffold-only unless we explicitly design a better authoring flow
3. Implement the first bench runner v2 slice:
   - one benchmark category
   - one model
   - `stagehand` harness only
   - clear Braintrust naming/reporting expectations
4. Implement the first external harness spike:
   - `claude_code`
   - `browse_cli`
   - one active agent benchmark case
5. Re-plan representation after the first external harness proves the harness abstraction.

## Next Steps

The bench runner v2 proposal is now captured in this plan and in `spec.md`. The next implementation pass should start with the smallest compatibility-preserving slice:

1. Keep planned files behavior-compatible:
   - `framework/benchHarness.ts`
   - `framework/benchPlanner.ts`
   - `framework/benchRunner.ts`
2. Move the current bench path behind the `stagehand` harness.
3. Add `--harness`, defaulting to `stagehand`.
4. Add matrix-axis metadata for current bench runs.
5. Add a planner test for:
   - one `observe` task
   - one explicit model
   - `stagehand`
6. Add shared external evaluators for `webvoyager`, `onlineMind2Web`, and `webtailbench` after the executable Claude Code path is green.

Compatibility rules for that pass:

- `--model`
- `--provider`
- `--tool`
- `--startup`
- `--limit`
- `--sample`
- `--filter`
- benchmark shorthand targets
- quiet/verbose output behavior

## Deferred

- representation task design and scoring
- fanout UX for running multiple tool surfaces from one command while still producing separate Braintrust experiments
- bench-on-top-of-core implementation work
- redesigned task-authoring UX for `evals new`
- separate evaluator package boundary; keep evaluator implementation in `packages/evals` until the abstraction stabilizes
