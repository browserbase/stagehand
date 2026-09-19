# Jev act path (experimental)

Resolves `act("…")` through a decision tree of [TypeSafe Jev](https://docs.typesafe.ai) questions
instead of one LLM call, and hands the act to the existing LLM pipeline whenever Jev is not
confident. Jev is a System One model: it answers typed questions (Choice / Noul) with
probabilities, cannot generate text, and costs roughly 100–300 ms and a few thousand input tokens
per request.

Off unless `experimentalJevAct` is present in the init params. The TypeScript SDK sets it from the
`STAGEHAND_EXPERIMENTAL_JEV_ACT` environment variable (the config below, as JSON); it is
deliberately not a field of the public create config. Evals build that variable from
`EVAL_JEV_ACT=1` and the other `EVAL_JEV_*` switches in `packages/evals/initStagehand.ts`.

## Flow

| Step           | Who                                            | Notes                                                                                                                                                                                                                                                                                           |
| -------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Modifier check | code                                           | `ctrl+a`, `shift+click` go straight to the LLM.                                                                                                                                                                                                                                                 |
| Intent         | Jev, 1 request, no snapshot                    | Action family, key, scroll scope, mouse button, checkbox end state, which quoted string is the text to type, whether a suggestion must be picked after typing. `click`/`select` and `click`/`double_click` splits are merged.                                                                   |
| Arguments      | code, else argument-only LLM                   | Quoted strings, `%variables%`, percentages and keys are parsed. Unquoted text comes from a tiny LLM call that must return text lifted from the instruction.                                                                                                                                     |
| Candidates     | code                                           | Role view per family, then every named element. Described with name, ancestors, heading, card/row text for twins, `n of m`, iframe flag, DOM attributes for nameless controls. Lists over 40 are first cut to the 30 sharing words with the instruction; one exact quoted-name match skips Jev. |
| Pick           | Jev, 1 request (parallel shards on huge lists) | One exact quoted-name match is confirmed with a single small request instead of ranking the list. `best` (no none option) + `strict` (none vetoes above 0.9). A pick strict is uneasy about is held while the next tier tries. Indistinguishable twins share their vote.                        |
| Act            | code                                           | Same `Action` shape as the LLM path, so caching and replay are unchanged. Detached fill targets are re-picked once.                                                                                                                                                                             |
| Checks         | code                                           | Fill read-back, native `<select>` `[selected]` flag, no-effect retry on a credible runner-up. `verify: "full"` adds a logged-only Jev yes/no.                                                                                                                                                   |
| No target      | Jev, 1 request                                 | Page-state signals; access-denied / captcha fail fast. Otherwise the LLM gets Jev's shortlist (with each item's card/row) before the whole tree.                                                                                                                                                |

Steps that do not depend on each other overlap: the intent request needs no page, so it is asked
while `act()` waits for the DOM to settle (a fixed 500 ms quiet window at minimum), and nothing
reads or touches the page before that wait is over; `observe()` asks its intent while the snapshot
is captured. The per-act log reports `durationMs` (pipeline) and `totalMs` (from the start of
`act()`, settle included).

Also reused outside `act` inference: `cacheCheck.ts` asks one yes/no before a cached action is
replayed, so a selector that now resolves to a different control is re-inferred instead of clicked.

## Files

- `pipeline.ts` — orchestration per family (`press`, pointer, `fill`, `select`, scroll, `drag`).
- `pick.ts` — tiers, pruning, shards, best/strict acceptance.
- `tree.ts` — outline parsing, views, candidate descriptions, focus outline, page digest.
- `args.ts` — deterministic argument parsing and grounding.
- `pageState.ts`, `cacheCheck.ts`, `typesafeClient.ts`.

## Configuration (`experimentalJevAct`)

| Field           | Default    | Meaning                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apiKey`        | required   | TypeSafe key. `apiUrl` (https only) and `model` are optional.                                                                                                                                                                                                                                                                                                                                       |
| `enabled`       | `true`     | `false` keeps only the per-act timing log (eval baselines).                                                                                                                                                                                                                                                                                                                                         |
| `actConfidence` | `0.7`      | Minimum confidence to act on a node's answer.                                                                                                                                                                                                                                                                                                                                                       |
| `verify`        | `"checks"` | `"checks"`: fill read-back + native-select flag. `"full"` adds a logged-only Jev yes/no. `"off"`: none.                                                                                                                                                                                                                                                                                             |
| `llmFallback`   | `true`     | `false` fails the act when Jev abstains: the fastest way to see what Jev alone gets wrong.                                                                                                                                                                                                                                                                                                          |
| `argumentLlm`   | `true`     | The argument-only LLM call for unquoted text. Independent of `llmFallback`; turn both off for an LLM-free run. The typed text is always the instruction's own characters, never the model's re-cased copy.                                                                                                                                                                                          |
| `pageState`     | `true`     | Page-state request when Jev leans toward "not on this page".                                                                                                                                                                                                                                                                                                                                        |
| `cacheCheck`    | `false`    | Before each cached action is replayed, one Jev yes/no checks that its selector still points at a matching element; stale ones are re-inferred. Adds a snapshot per cached action, and a request when the selector still resolves in it.                                                                                                                                                             |
| `extract`       | `"off"`    | `"judge"`: Jev's yes/no replaces extract()'s completion LLM call. `"pick"`: Jev picks the elements holding each scalar or list field's value and code copies their text; booleans and enums are judged directly; schemas the planner cannot map, unresolved required fields, or a failed completion gate send the whole extraction to the LLM. **Both send page or extracted content to TypeSafe.** |
| `observe`       | `false`    | Resolve `observe()` through Jev first. "Find all" is answered exhaustively or handed to the LLM (over 600 candidates; over 400 elements with no instruction), never truncated.                                                                                                                                                                                                                      |
| `tools`         | `false`    | Let `act()` invoke a WebMCP tool the page registered when Jev is sure the tool is the request (see below). Sends tool names and descriptions to TypeSafe, and for the two tools sharing most words with the instruction also their parameter names, descriptions, types and enum values.                                                                                                            |
| `retryNoEffect` | `false`    | Click the runner-up when an ambiguous click provably changed nothing. Off: effects the outline cannot show (aria-pressed, copy, play) look like "nothing". Never cached.                                                                                                                                                                                                                            |
| `focusFallback` | `false`    | On trees over 120K chars, show the LLM Jev's shortlist first. Off: it found the target in a minority of firings and cost accuracy on ordinary pages.                                                                                                                                                                                                                                                |

## WebMCP tools (`tools: true`)

The page's tools are listed while `act()` waits for the DOM to settle, and the tool questions ride
in the intent request that every act already makes, so a page without tools adds no question and a
page with tools adds no round trip. Alongside "which tool" (with a "none" option) a guard asks
whether the instruction names a control: "click the Add to cart button" always takes the element
path, even when `add_to_cart` exists. A tool is used only at ≥ 0.8 with "none" ≤ 0.2.

Arguments are picked by Jev as spans of the instruction (enums and booleans as choices) and accepted
only when every parameter, stated or not, is ≥ 0.8. The argument questions of the two tools whose
names and descriptions share most words with the instruction ride in the same request, so a
confident tool call is usually one request (~300 ms); another winner costs one more. Values that
are not spans (dates to normalise, lists, nested objects) go to an argument-only LLM call that sees
just that tool, with its input schema as the response format; when the schema alone shows the
likely tool will need it, that call starts alongside the Jev request. Any doubt means the ordinary
act path continues from the intent it already has. Once a tool has been invoked the act is over,
success or error: it never also clicks through the UI. Tool acts are not cached.

```ts
// TypeScript SDK; Chrome needs its WebMCP features on, which localBrowser.launch() does.
process.env.STAGEHAND_EXPERIMENTAL_JEV_ACT = JSON.stringify({ apiKey, tools: true });
const stagehand = await Stagehand.create({ browser, model });
await page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/webmcp-test/");

await stagehand.act("add 19 and 23 together");
// → { method: "webmcp", selector: "webmcp:calculateSum", arguments: ['{"a":19,"b":23}'] }
//   message: 'Invoked WebMCP tool calculateSum: {"a":19,"b":23,"sum":42}'   (one Jev request, no LLM call)

await stagehand.act("click the Calculate button");
// → names a control, so the ordinary element path runs
```

On 380 LLM-written requests over 166 tools harvested from six live sites: tool choice answered by
Jev for 79% of requests at 99% precision; arguments filled by Jev for 69% of calls at 98% precision.

## What leaves the process

Sent to TypeSafe: the instruction, candidate descriptions built from the accessibility outline
(names, nearby text, card/row text, DOM attributes of nameless controls), the page URL without
query string or fragment, a digest of the first visible content (page state), and — only with
their own opt-ins — extracted data (`extract`) and cached action descriptions (`cacheCheck`).
Resolved `%variable%` values of three or more characters are replaced by their placeholder in every
request and in the trace
log, including when an earlier act already typed them into the page. With the flag on, each act
logs its instruction and a trace of candidate descriptions at info level.

## Known limits

- Jev usage is logged but not part of `result.metadata.usage`. With `tools`, an argument LLM call
  started speculatively and not used finishes after the act has returned, and its tokens are not
  counted anywhere.
- Thresholds (0.7 accept, 0.9 none veto, 0.7 held-pick cap) were set on the act and breadth suites.
  The cache-check threshold (0.35) comes from direct API probes; no eval exercises the cache path.
- No eval exercises page-state fail-fast or `retryNoEffect` end to end; both have unit tests only.
- Modifier chords, file upload and unquoted `<select>` options on selects with more than 254
  options go to the LLM.
