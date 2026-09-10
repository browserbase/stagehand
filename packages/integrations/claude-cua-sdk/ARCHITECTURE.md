# claude-cua-sdk — Claude's Browser Use toolset on a Stagehand browser

The private package implements the evals `claude_cua` harness. It shares the canonical facade runtime and runner-owned browser with other mounted harnesses.

## What it is

Anthropic's Messages API ships a fixed-member browser tool
(`browser_toolset_20260801`, "Browser Use"): the model emits `tool_use` blocks
such as `navigate`, `left_click {target:{type:"ref",ref}}`, `read_page`,
`javascript_exec`, and expects `tool_result` blocks (text, images,
`browser_state`) back. This package runs that loop and executes every member
against a Stagehand browser through the facade's Playwright-compat batch
runtime, with facade batching for browser actions. Some members require multiple calls, as detailed below.

```
 ┌──────────────────────────┐   tool_use / tool_result   ┌────────────────────────────┐
 │ Anthropic Messages API   │◀──────────────────────────▶│ runClaudeCuaSession        │
 │ browser_toolset_20260801 │   (toolset_name:"browser") │ session.ts — the loop      │
 └──────────────────────────┘                            └─────────────┬──────────────┘
                                                                        │ CuaToolExecutor.execute(member, input)
                                                          ┌─────────────▼──────────────┐
                                                          │ StagehandCuaExecutor       │
                                                          │ executor.ts — member →     │
                                                          │ facade round trip(s)       │
                                                          └─────────────┬──────────────┘
                                                                        │ CuaFacadeTools: run(code) | runActions | snapshot | screenshot
                        in-process ──────────────────────┐    ┌─────────▼──────────────┐    ┌────── over the evals bridge (MCP stdio)
                        new StagehandFacadeTools(sh)     │    │ facade batch runtime   │    │  bridgeCuaFacadeTools(callTool)
                                                         └───▶│ tools.ts + runtime.ts  │◀───┘
                                                              │ experimentalBatch(cb)  │
                                                              └─────────┬──────────────┘
                                                                        │ one batch RPC
                                                          ┌─────────────▼──────────────┐
                                                          │ Stagehand SDK ▸ extension ▸ │
                                                          │ Chrome (local/Browserbase)  │
                                                          └────────────────────────────┘
```

Files: `src/toolset.ts` (declaration, member lists, `CuaToolExecutor` contract),
`src/session.ts` (loop), `src/executor.ts` (Stagehand executor),
`src/transcript.ts` (readable transcript).

## The loop (`runClaudeCuaSession`)

- Request: `tools: [{ type: "browser_toolset_20260801", configs }]`, no beta
  header. `javascript_exec` is **enabled by default** (`configs.javascript_exec.enabled=true`);
  pass `toolsetConfigs: { javascript_exec: { enabled: false } }` to opt out.
  `file_upload` / `read_console` / `read_network` stay off (the API default).
- Thinking: `{ type: "adaptive", display: "summarized" }` with `xhigh` effort by
  default so the transcript carries reasoning (Claude 5 defaults to `omitted` =
  empty text). `effort` can be configured. `{type:"enabled", budgetTokens}` is
  available for pre-4.6 models; `{type:"disabled"}` turns it off.
- Prompt caching: top-level `cache_control: {type:"ephemeral"}`; tools, system
  and transcript form a stable prefix. Older screenshots (beyond the 3 most
  recent) are replaced by a text placeholder before each request to bound context.
- Turn handling: the assistant turn is echoed back verbatim (thinking blocks
  and `toolset_name` included). Members run **sequentially**; the first
  `is_error` halts the rest of that turn with the spec's halt text. Unknown tool
  names get an `is_error` result. `stop_reason: refusal` → `sdk_error`;
  `max_tokens` → bounded "continue" nudge (2); no tool calls → `completed`.
- Result: `events` (assistant / tool_use / tool_result), `finalMessage`,
  `status` (`completed | max_turns | sdk_error`), `stopReason`,
  `tokenUsage { input, output, cache_read, cache_creation, total }`, turn and
  tool-call counts.

## The executor (`StagehandCuaExecutor`)

Runs over `CuaFacadeTools`: the canonical facade's `run`, `snapshot` and `screenshot` tools, plus the `runActions` hydrated-action helper:

| facade tool         | what it is                                                                                                  |
| ------------------- | ----------------------------------------------------------------------------------------------------------- |
| `run(code)`         | one `experimentalBatch`; `page`/`context`/`browser` (Playwright-compat) and `batchStagehand` (raw) in scope |
| `runActions([...])` | one `experimentalBatch` over hydrated snapshot ids (`click/hover/fill/type/press/select`)                   |
| `snapshot()`        | accessibility tree with bracketed ids; re-hydrates the active page's id → xpath map                         |
| `screenshot(opts)`  | PNG/JPEG of the active page                                                                                 |

`StagehandFacadeTools` (integrations core) satisfies the interface in-process
(`createStagehandCuaExecutor(stagehand, …)`); the evals runner implements it
over its runner-owned MCP bridge (`bridgeCuaFacadeTools`).

### Element references

Refs are the **facade's snapshot ids** (`<frameOrdinal>-<backendNodeId>`, e.g.
`0-7812`). `read_page` / `find` return the tree with those ids and tell the
model to target them as `{type:"ref",ref:"0-7812"}`; `runActions` resolves them
through the facade's per-page id map, so a stale id fails with the facade's own
"call snapshot again" message and the model recovers by calling `read_page`.

### Member → facade mapping and round trips

Every mutating `run` snippet ends with a tab-inventory tail, so the
`browser_state` block costs no extra trip. "RT" = facade round trips per call.

| member                                               | facade call(s)                                                                                                          | RT  |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --- |
| `navigate` (url / back / forward / reload)           | `run`: `page.goto` / `goBack` / `goForward` / `reload` (domcontentloaded) + tabs                                        | 1   |
| `screenshot`                                         | `screenshot({type:"png"})` → image block                                                                                | 1   |
| `zoom`                                               | `run`: `page.screenshot({clip})`, base64 built in-batch → image block                                                   | 1   |
| `left_click` (ref)                                   | `runActions [{op:"click"}]`; reported url refreshes cached tab state                                                    | 1   |
| `left/right/middle/double/triple_click` (xy)         | `run`: `batchStagehand.page.click(x,y,{button,clickCount})` + tabs                                                      | 1   |
| `hover` (ref / xy)                                   | `runActions [{op:"hover"}]` / `run`: `page.hover(x,y)` + tabs                                                           | 1   |
| `mouse_move`                                         | `run`: `page.hover(x,y)` + tabs                                                                                         | 1   |
| `left_click_drag`                                    | `run`: native `page.dragAndDrop` (press, midpoint, endpoint, release) + tabs                                            | 1   |
| `scroll` (xy)                                        | `run`: `page.scroll(x,y,dx,dy)` (wheel) + tabs                                                                          | 1   |
| `scroll` (ref)                                       | `runActions [{op:"hover"}]` (into view) then `run`: wheel at viewport centre                                            | 2   |
| `scroll_to` (ref)                                    | `runActions [{op:"hover"}]` (Playwright hover scrolls into view)                                                        | 1   |
| `type`                                               | `run`: `page.type(text)` + tabs                                                                                         | 1   |
| `key`                                                | `run`: `page.keyPress(chord)` per chord × repeat (CUA names → Playwright) + tabs                                        | 1   |
| `wait`                                               | `run`: `page.waitForTimeout` (≤30 s) + tabs                                                                             | 1   |
| `read_page` (`filter`, `depth`)                      | `snapshot()`; filtered/indent-limited on this side; header from the root node                                           | 1   |
| `find`                                               | `snapshot()`; lexical token match, top 20 (no model-backed locator on the facade)                                       | 1   |
| `get_page_text`                                      | `run`: `page.evaluate(innerText of article/main/body)`                                                                  | 1   |
| `form_input` (string)                                | `runActions [{op:"fill"}]`; on `unsupported-element` (a `<select>`) → `[{op:"select"}]`                                 | 1–2 |
| `form_input` (boolean)                               | `runActions [{op:"click"}]` — toggles; result says to verify with `read_page`                                           | 1   |
| `javascript_exec`                                    | `run`: `page.evaluate(script)`; result stringified                                                                      | 1   |
| `new_tab` / `list_tabs` / `switch_tab` / `close_tab` | `run` on visible `context` (`newPage` / `pages`) and compat pages (`bringToFront` / `close`); one `browser_state` block | 1   |

An ordinary member with `tab_id` first selects that tab through the canonical visible facade context and refreshes cached active identity (one extra round trip). Unknown tabs fail before the action runs. Tab IDs come from the readonly `page.pageId` getter; keeper pages stay hidden and missing IDs fail descriptively. The last visible page cannot be closed through the toolset. A first ref action after `read_page` or `find`, before any tab inventory is cached, adds one inventory round trip to obtain actual tab IDs. Subsequent ref actions refresh the cached active URL without that extra call.

No facade equivalent — returned as a recoverable `is_error` naming an
alternative, never stubbed:

| member / variant                                                   | why                                                                               |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| right/middle/double/triple click **on a ref**, all modifier clicks | facade ref actions are single left clicks; SDK clicks have no modifiers           |
| `left_mouse_down`, `left_mouse_up`                                 | no held-button primitive across tool calls; use `left_click_drag` or `left_click` |
| `hold_key`                                                         | the facade page exposes no keyDown/keyUp                                          |
| `file_upload`, `read_console`, `read_network`                      | not exposed by the facade (also unsupported by the reference executor)            |

Errors: member failures become `{ content: "Error: …", isError: true }`. A typed canonical facade session-loss error or runner-owned loss telemetry terminates the session with `sdk_error`; page/agent error text alone cannot establish terminal loss. Diagnostic logs retain member names, status and duration; tool inputs remain in the session evidence rather than debug messages.

## Evidence back into `tool_result`

- `screenshot` / `zoom` return `{type:"image", source:{type:"base64", media_type, data}}`.
- `read_page` / `find` / `get_page_text` / `javascript_exec` return text (a11y
  tree with ids, matches, page text, evaluated value; capped at 120k chars).
- Mutating members return short text plus a `browser_state` block (`tabs`,
  `state_changes`) when the tab inventory or active URL changed; tab members
  return exactly one `browser_state` block.
- Hosts can hook `onMutation(toolUseId)` for out-of-band evidence; the evals
  harness records screenshot + URL after each mutating member and attaches them
  to trajectory steps by tool_use id. The verifier gets both the model-facing
  screenshots (from tool results) and those probes.

## Usage and cost

`tokenUsage` is the raw Messages API shape: `input` excludes cache reads and
writes, which are reported separately (`anthropic_cache_separate` in the evals
normalizer: `input_total = input + cache_read + cache_creation`). The toolset's
injected definitions are ~7k tokens and land in `cache_creation` on the first
turn. The Messages API reports no dollars; the evals harness computes cost at
Anthropic list price (`billing_channel: anthropic_api`, `cost_source: computed`).

Model support: the public harness allowlist is `claude-opus-4-8`,
`claude-opus-5`, `claude-sonnet-5`, `claude-fable-5`, and `claude-fable-5-1`.
The evals default is `claude-sonnet-5`; models outside the list are warned
about but not rejected.

## Evals harness (`claude_cua`)

`packages/evals/framework/claudeCuaRunner.ts` + `claudeCuaToolAdapter.ts`,
registered through `defineExternalHarness`. Tool surface
`anthropic_browser_toolset`: same facade server and runner-owned bridge as
`stagehand_facade`, but the agent sees Anthropic's tool definitions, so cells on
this surface compare with other harnesses **on the model axis only**. Step
budget: `EVAL_CLAUDE_CUA_MAX_TURNS` → `AGENT_EVAL_MAX_STEPS` → 100 on HardBench
→ 50. Thinking: `EVAL_CLAUDE_CUA_THINKING_EFFORT`, `EVAL_CLAUDE_CUA_THINKING_BUDGET`,
`EVAL_CLAUDE_CUA_THINKING=off`. Live acceptance (2026-08-31): HardBench
`47e314cc` passed on `claude-sonnet-5`, 83 members, process score 1.0.

## Open design questions for review

1. **Ref namespace.** Refs are facade snapshot ids today (zero-cost, resolved by
   the facade). A CUA-native `ref_N` map minted on this side would let the
   executor resolve refs itself and unlock right/double click and modifiers on
   refs (via `page.locator(xpath)` in a batch), at the cost of holding an
   id → xpath map per page here and one more place where refs can go stale.
   Which side should own the map?
2. **`find` quality.** The reference uses `observe` (model-backed). The facade
   has no locator model, so `find` is a lexical match over the tree. Acceptable,
   or should `find` call Stagehand `observe` through a batch?
3. **`computer_toolset_20260801`.** Coordinate-only members are already
   implemented (click/drag/scroll/type/key/screenshot/zoom); adding the computer
   toolset is mostly declaration + `cursor_position`. Do we want it as a second
   surface for coordinate-vs-ref comparisons?
4. **Thinking defaults.** Adaptive + summarized, no `effort`. Should the harness
   pin `effort` (e.g. `high`) for comparability with other Anthropic cells, or
   leave the API default?
5. **Per-step evidence cost.** The evals hook spends two bridge calls
   (screenshot + url) after every mutating member. Keep, sample, or derive the
   URL from the tab tail that every mutating batch already returns?
6. **Batch coalescing across members.** Members are executed one per batch; the
   API sends several `tool_use` blocks per turn. A turn-level coalescer could
   run consecutive coordinate/keyboard members in one batch (halting on the
   first failure to keep the spec'd contract). Worth it before measuring?
7. **`form_input` booleans.** Without element state on this side, a boolean is
   a click. Should the executor read `checked` first (one extra batch) so the
   semantics match the spec exactly?

## Evaluation lifecycle

The eval runner sends the shared evaluation policy once in the native system channel. Budgets count API turns; one turn may include several tool calls. Session abort is passed to the Messages request and checked between actions. Terminal browser-session loss ends the loop; evidence capture does not hide it. The eval adapter shares typed MCP decoding and bounded idempotent cleanup with other native CUA providers.
