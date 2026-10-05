# Shared eval harness contract

External harnesses use the runner-owned tool mount. The default is `stagehand_facade`
where supported; `stagehand_facade_legacy` remains explicitly selectable. Provider
adapters translate their protocols to that shared runtime. They do not start a
second browser or implement a separate Playwright facade.

## Prompt and execution configuration

The eval runner owns the no-clarification policy in `evalSystemPrompt.ts`. It is
injected once through an additive system/developer channel when available;
otherwise it is included once in the task prompt. Harness stock prompts remain
in place. A caller-supplied Codex client and remote Eve use the task-prefix path.
The Cursor SDK's replacement system-prompt option is intentionally unused.

Budget precedence is the harness-specific environment variable, then
`AGENT_EVAL_MAX_STEPS`, then the dataset default (HardBench: 100), then the
historical harness default. Only positive safe integers are accepted.
`harnessConfiguration` records the effective budget, unit, policy channel/version,
and requested reasoning settings where supported. Equal budget numbers do not
mean equal work:

| Harness                                 | Counted unit          |
| --------------------------------------- | --------------------- |
| Codex, Cursor, DeepAgents               | Tool calls            |
| Eve                                     | Successful tool calls |
| Mastra, mastracode                      | Model steps           |
| fx                                      | Agent steps           |
| Claude Code, Pi, Claude CUA, Gemini CUA | Turns                 |

These are execution limits, not comparable measures of model efficiency.

## mastracode (`--harness mastracode`)

`mastracode` is Mastra's coding-agent CLI (npm `mastracode`, pinned in
`packages/integrations/mastracode-sdk`), not the Mastra agent SDK behind `mastra`.
Each task spawns a driver (`mastracode-sdk/dist/driver.mjs`) in its own Node process
group. The driver calls mastracode's own SDK (`createMastraCode` + `runMC`, the path
`mastracode --prompt` takes). The runner writes one request to stdin
(`MastracodeDriverRequest`: prompt, `hostInstructions`, model id, step budget,
timeout, MCP servers, allowed tool names, per-task directories). The driver answers
with JSONL events on stdout: `ready`, `request`, `request_usage`, `tool_start`,
`tool_end`, `step`, `violation`, then one `done`.

- **Facade only.** The Stagehand facade is the only MCP server. One eval mode
  allowlists exactly `stagehand_run`, `stagehand_snapshot`, and
  `stagehand_screenshot` (`availableTools`, enforced through AI SDK `activeTools`).
  This also hides mastracode's workspace and controller tools. `disabledTools`
  removes the auto-added provider `web_search` and the workflow, inbox, and
  access tools. Subagents, hooks, plugins, GitHub signals, and interval handlers
  are off. mastracode builds its system-prompt tool guidance from
  `state.permissionRules`, not from `availableTools`, so the driver also sets a
  `deny` rule for every non-facade tool name (`MASTRACODE_PROMPT_DENIED_TOOLS`:
  workspace tools, `ask_user`, the task tools, `submit_plan`, `subagent`,
  `web_search`/`web_extract`, memory and knowledge tools). Without it the prompt
  describes shell/file tools and "ask_user — use when you need clarification".
- **Request guard.** The driver's fetch spy inspects every model request. If a
  request offers any other tool, the driver blocks it, emits `violation`, and the
  run records `harnessStatus: sdk_error` with `harnessStopReason:
tool_isolation_violation`.
- **Isolation.** The workspace, HOME, and `MASTRA_APP_DATA_DIR` are fresh empty
  temp directories. The driver env is an allowlist: provider keys, base URLs,
  proxies, and `NODE_OPTIONS`. `MASTRA_GATEWAY_API_KEY`, `TAVILY_API_KEY`,
  `PARALLEL_API_KEY`, and `MASTRA_DB_*` never reach it. The MCP child gets the fx
  child-env allowlist and no provider keys.
- **Prompt.** The eval policy goes in as `hostInstructions`, appended to
  mastracode's system prompt (`systemPromptMode: native`). mastracode's
  coding-agent base prompt and its observational memory stay in place. They
  cannot be replaced, and the task-state signal requires memory. Both are a
  confound against other harnesses. Residual prompt text that no setting
  removes (checked against @mastra/code-sdk 1.8.0): the mode prompt falls back
  to BUILD mode for the `eval` mode id ("You have full access to all tools ...
  execute commands", "stop and ask the user" when approaches diverge); the tool
  guidance header says shell commands run via `execute_command`; the base
  prompt keeps its coding, git, and PR sections and lists common binaries found
  on the driver's PATH. The eval mode instructions state that there is no user
  to ask and that coding guidance does not apply, which contradicts that text
  but does not remove it.
- **Caching.** Only the direct `anthropic/*` route (with `ANTHROPIC_API_KEY`) gets
  prompt caching: `promptCacheMiddleware` marks the last system message and the
  last message (2 breakpoints per request, recorded as
  `mastracode_cache_breakpoints_per_request`). `openai/*` relies on OpenAI's
  automatic caching. Other routes (models.dev router, Mastra gateway) get no
  breakpoints. They are rejected unless `EVAL_MASTRACODE_ALLOW_UNCACHED_ROUTES=1`,
  and then recorded as `cacheRoute: none`.
- **Steps and usage.** One step is one `usage_update` (a model step). The driver
  aborts after the budget-th step that called tools, and the run records
  `max_turns`. Usage is the sum of every step. `promptTokens` is the whole prompt,
  and cache read and cache write are subsets (`openai_cached_subset`). A bucket no
  step reported stays missing. Cost is computed at list price from the reported
  buckets, cache writes included.
- **Side calls.** Tool-less calls mastracode makes on its own (thread titles,
  observational-memory observer and reflector) emit no `usage_update`. They
  default to `google/gemini-3.5-flash` (`DEFAULT_OM_MODEL_ID`), which has no key
  in the driver env. The driver pins `observerModelId`/`reflectorModelId` (and
  `DEFAULT_OM_MODEL_ID`) to the eval model, so they take the same route. The
  driver reads their usage from the raw responses and reports it as
  `mastracode_side_*` metrics. `cost_usd` excludes these calls. Gemini
  `generateContent` and Bedrock calls are still recorded as `request` events
  (provider `google` / `other`), so an unexpected route shows up in the run.
  Before `done`, the driver waits up to 15 s for in-flight calls (the title
  call starts after the run settles).
- **Lifecycle.** Driver startup (mastracode boot, MCP connect + `listTools`,
  model switch) has its own deadline, because runMC's timeout starts only after
  it and mastracode's MCP client waits up to 7 days. An overrun ends the task as
  `sdk_error` / `startup_timeout`. The runner reaps the driver's process group
  when the driver exits. The driver polls for its parent: if the evals process
  dies without cleanup (SIGKILL, V8 heap OOM), it aborts the run and kills its
  own process group, MCP children included.

Knobs: `EVAL_MASTRACODE_MAX_STEPS`, `EVAL_MASTRACODE_MODELS`,
`EVAL_MASTRACODE_THINKING_LEVEL` (`off|low|medium|high|xhigh|max`; unset keeps
mastracode's default), `EVAL_MASTRACODE_TIMEOUT_MS` (driver wall clock, default 1 h),
`EVAL_MASTRACODE_STARTUP_TIMEOUT_MS` (driver startup, default 120 s; the runner
hard-kills at startup + wall clock + 30 s), `EVAL_MASTRACODE_DRIVER_PATH`, and
`EVAL_MASTRACODE_ALLOW_UNCACHED_ROUTES`.

## Session and result records

The mounted surface supplies session identity and evidence. Session ownership,
first terminal browser loss, and cleanup live in the shared runtime. Capture
recovery permits two consecutive capture deadlines; the third ends the session.
A successful capture resets the counter. Timed-out work cannot replace newer
snapshot IDs, and failed actions are not replayed. CDP heartbeat and sanitized
`CDP_DROP` diagnostics are available; automatic reconnect is not implemented.

`harnessStatus` and `terminationReason` describe execution. The verifier determines
completion from evidence, including work completed before a late disconnect.
When verification fails, `_success` is false, `verifierError` records the failure,
and the agent's report is preserved separately. Captured trajectories and raw
judge uncertainty are retained when persistence is enabled. See
[verification gates](verifier-gates.md) for scoring and audit fields.

## Usage and cost

Raw token usage is normalized according to the SDK's cache conventions.
Observed zero is distinct from missing telemetry; missing usage and unknown
subscription bills do not become zero-dollar runs. Reported bills take precedence.
Direct-provider estimates use the dated checked-in price map and include
`cost_source: computed` and `cost_pricing` (date, matched model, source).
These are list-price estimates, not invoice reconciliation or current-price claims.

Cursor runs use the SDK through `--harness cursor` and record implementation/version
provenance. Historical CLI `cursor` and `cursor_sdk` records remain readable;
missing provenance is not retroactively interpreted as an SDK run.
