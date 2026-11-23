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

Mastra ships no system prompt, so the adapter's instructions are the whole prompt and
there is no stock prompt to keep. `mastraInstructions.ts` holds them. By default the
agent gets general browsing guidance and a finish check, one follow-up sent the first
time it stops on its own that asks it to re-read the task and either keep working or
restate its answer. The check continues the same conversation, shares the step budget,
and cannot turn a finished run into a failed one: if it errors, runs out of steps or
adds no text, the first answer stands. For `anthropic/` models the adapter also asks
Anthropic to cache the prompt, which Anthropic does only on request.

| Variable                           | Effect                                   |
| ---------------------------------- | ---------------------------------------- |
| `EVAL_MASTRA_INSTRUCTIONS=minimal` | The earlier one-line prompt              |
| `EVAL_MASTRA_FINISH_CHECK=0`       | No finish check                          |
| `EVAL_MASTRA_PROMPT_CACHE=0`       | No cache request for `anthropic/` models |

`harnessConfiguration` records all three settings.

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
| Mastra                                  | Model steps           |
| fx                                      | Agent steps           |
| Claude Code, Pi, Claude CUA, Gemini CUA | Turns                 |

These are execution limits, not comparable measures of model efficiency.

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
