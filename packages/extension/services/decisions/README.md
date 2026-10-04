# Decisions (experimental)

Resolves `act()`, `observe()` and `extract()` through small typed questions to a **decision
model** instead of one LLM call, and hands over to the existing LLM pipeline whenever the model is
not confident. A decision model answers "which of these options" (Choice) and "yes or no" (Noul)
with probabilities; it cannot generate text, and answers in roughly 100–300 ms for a few thousand
input tokens per request.

Off unless `experimentalDecisions` is present in the init params. The TypeScript SDK sets it from the
`STAGEHAND_EXPERIMENTAL_DECISIONS` environment variable (the config below, as JSON); it is
deliberately not a field of the public create config. Evals build that variable from
`EVAL_DECISIONS=1` and the other `EVAL_DECISIONS_*` switches in `packages/evals/initStagehand.ts`.

## Providers

`provider` selects the service; everything above the client (`client.ts`) is provider-agnostic.

| `provider`             | Model (default)                 | Needs                 | Wire format                                                                  | Verified                                                        |
| ---------------------- | ------------------------------- | --------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `"typesafe"` (default) | Jev (`jev-latest`)              | `apiKey`              | System One: `{ state, questions }` → `{ answers }`                           | Live, and by every eval in this stack                           |
| `"cloudflare"`         | Clef (`clef`, or `clef-flash`)  | `apiKey`, `accountId` | System One body on Workers AI `/ai/run/@cf/cloudflare/<model>`, `{ result }` | Against the documented format                                   |
| `"perplexity"`         | Decider (`pplx-decider-v1-27b`) | `apiKey`              | System One body on `/v1/decisions`                                           | Against the documented format                                   |
| `"openai"`             | Decisions API (`gpt-6-luna`)    | `apiKey` with preview | `{ input, questions: [...] }` → `{ answers: [...] }`                         | Against a response recorded by a preview user; no public schema |

What `client.ts` does for all of them, so the pipeline sees one behaviour:

- **Validation.** An answer is used only if its choice is one of the offered options, every
  probability is in range, the distribution is consistent (does not exceed 1; sums to 1 when all
  options are listed) and the choice is its most likely option. Anything else is a typed error and
  the act falls back.
- **Ids and text.** TypeSafe takes JSON instructions and any ids. The others take text and a
  restricted id alphabet: question keys and option ids outside it are sent under an alias (the
  description keeps the original), and JSON is serialised. Answers always come back under the
  caller's own ids.
- **Limits.** A request with more questions than the provider takes (64 Cloudflare and OpenAI, 128
  Perplexity) is split over the same state and merged. A choice among one option is answered
  locally as certain and never sent.
- **Failure handling.** Per-provider timeout (8 s TypeSafe, 15 s others), retry on 429/529 honouring
  `Retry-After`, and a circuit breaker per provider + endpoint + key (60 s after an auth failure,
  30 s after three consecutive failures, malformed payloads included).

Thresholds (0.7 accept, 0.9 "none" veto, …) were tuned on Jev. Another model's probabilities are
not calibrated the same way: treat them as starting points and re-run the evals per provider.

`tests/decisionsProviders.test.ts` runs one request through all four wire formats;
`tests/decisionsCrossProvider.test.ts` runs act, observe, extract and tool scenarios through each;
`DECISIONS_LIVE=1` with any provider key runs `tests/decisionsProvidersLive.test.ts` against the
real services.

## Flow

| Step           | Who                                                           | Notes                                                                                                                                                                                                                                                                                                          |
| -------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Modifier check | code                                                          | `ctrl+a`, `shift+click` go straight to the LLM.                                                                                                                                                                                                                                                                |
| Intent         | the decision model, 1 request, no snapshot                    | Action family, key, scroll scope, mouse button, checkbox end state, which quoted string is the text to type, whether a suggestion must be picked after typing. `click`/`select` and `click`/`double_click` splits are merged.                                                                                  |
| Arguments      | code, else argument-only LLM                                  | Quoted strings, `%variables%`, percentages and keys are parsed. Unquoted text comes from a tiny LLM call that must return text lifted from the instruction.                                                                                                                                                    |
| Candidates     | code                                                          | Role view per family, then every named element. Described with name, ancestors, heading, card/row text for twins, `n of m`, iframe flag, DOM attributes for nameless controls. Lists over 40 are first cut to the 30 sharing words with the instruction; one exact quoted-name match skips the decision model. |
| Pick           | the decision model, 1 request (parallel shards on huge lists) | One exact quoted-name match is confirmed with a single small request instead of ranking the list. `best` (no none option) + `strict` (none vetoes above 0.9). A pick strict is uneasy about is held while the next tier tries. Indistinguishable twins share their vote.                                       |
| Act            | code                                                          | Same `Action` shape as the LLM path, so caching and replay are unchanged. Detached fill targets are re-picked once.                                                                                                                                                                                            |
| Checks         | code                                                          | Fill read-back, native `<select>` `[selected]` flag, no-effect retry on a credible runner-up. `verify: "full"` adds a logged-only decision-model yes/no.                                                                                                                                                       |
| No target      | the decision model, 1 request                                 | Page-state signals; access-denied / captcha fail fast. Otherwise the LLM gets the decision model's shortlist (with each item's card/row) before the whole tree.                                                                                                                                                |

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
- `pageState.ts`, `cacheCheck.ts`, `client.ts`, `providers.ts`.

## Configuration (`experimentalDecisions`)

| Field             | Default      | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `provider`        | `"typesafe"` | `"typesafe"`, `"cloudflare"`, `"perplexity"` or `"openai"` (see Providers).                                                                                                                                                                                                                                                                                                                                                                    |
| `apiKey`          | required     | The provider's key. `model` and `apiUrl` (https only) are optional; `accountId` is required for Cloudflare.                                                                                                                                                                                                                                                                                                                                    |
| `enabled`         | `true`       | `false` keeps only the per-act timing log (eval baselines).                                                                                                                                                                                                                                                                                                                                                                                    |
| `actConfidence`   | `0.7`        | Minimum confidence to act on a node's answer.                                                                                                                                                                                                                                                                                                                                                                                                  |
| `verify`          | `"checks"`   | `"checks"`: fill read-back + native-select flag. `"full"` adds a logged-only decision-model yes/no. `"off"`: none.                                                                                                                                                                                                                                                                                                                             |
| `llmFallback`     | `true`       | `false` fails the act when the decision model abstains: the fastest way to see what the decision model alone gets wrong.                                                                                                                                                                                                                                                                                                                       |
| `argumentLlm`     | `true`       | The argument-only LLM call for unquoted text. Independent of `llmFallback`; turn both off for an LLM-free run. The typed text is always the instruction's own characters, never the model's re-cased copy.                                                                                                                                                                                                                                     |
| `pageState`       | `true`       | Page-state request when the decision model leans toward "not on this page".                                                                                                                                                                                                                                                                                                                                                                    |
| `cacheCheck`      | `false`      | Before each cached action is replayed, one the decision model yes/no checks that its selector still points at a matching element; stale ones are re-inferred. Adds a snapshot per cached action, and a request when the selector still resolves in it.                                                                                                                                                                                         |
| `extract`         | `"off"`      | `"judge"`: the decision model's yes/no replaces extract()'s completion LLM call. `"pick"`: the decision model picks the elements holding each scalar or list field's value and code copies their text; booleans and enums are judged directly; schemas the planner cannot map, unresolved required fields, or a failed completion gate send the whole extraction to the LLM. **Both send page or extracted content to the decision provider.** |
| `observe`         | `false`      | Resolve `observe()` through the decision model first. "Find all" is answered exhaustively or handed to the LLM (over 600 candidates; over 400 elements with no instruction), never truncated.                                                                                                                                                                                                                                                  |
| `targetReadiness` | `false`      | Act as soon as the target is found and staying put, instead of waiting out the DOM-settle heuristic (see below). The settle wait remains the upper bound.                                                                                                                                                                                                                                                                                      |
| `tools`           | `false`      | Let `act()` invoke a WebMCP tool the page registered when the decision model is sure the tool is the request (see below). Sends tool names and descriptions to TypeSafe, and for the two tools sharing most words with the instruction also their parameter names, descriptions, types and enum values.                                                                                                                                        |
| `retryNoEffect`   | `false`      | Click the runner-up when an ambiguous click provably changed nothing. Off: effects the outline cannot show (aria-pressed, copy, play) look like "nothing". Never cached.                                                                                                                                                                                                                                                                       |
| `focusFallback`   | `false`      | On trees over 120K chars, show the LLM the decision model's shortlist first. Off: it found the target in a minority of firings and cost accuracy on ordinary pages.                                                                                                                                                                                                                                                                            |

## Target readiness (`targetReadiness: true`)

"Is the page loaded" is not something a snapshot can answer: on 30 sites sampled every 200 ms from
navigation start, the decision model rated a 1%-complete page as finished as the final one under four phrasings
(a half-loaded page reads as a smaller complete page). The settle heuristic (network quiet for
500 ms) is right far more often than DOMContentLoaded or the load event, and pays for it with a
median 1.2 s of waiting on a page that was already ≥ 90% there.

What an act needs is narrower and answerable: is the element it is about to use there, and is it
staying put. With this flag the first snapshot is captured while intent is asked and the pick runs
on it. Until the target is there and hittable the act keeps looking for as long as the settle wait
itself runs (a snapshot each round; the decision model is re-asked only when the candidates changed), so a target
that arrives late is acted on the moment it lands rather than at the end of the wait. Before going early, one in-page call on the picked element checks that the selector still
resolves to that node, that it is connected and enabled, that it sits in the same place two
animation frames later, and (for pointer actions) that a click at its centre would hit it rather
than an overlay. The settle wait is where polling ends. Covers
click / hover / double-click and fill; other families wait as before. Two-step widgets also stop
settling: after the opening action they wait in the page for a visible option, capped at 400 ms.

The same guard also runs right before every pointer act once the settle wait is over: the network
being quiet says nothing about what a click would hit, and a consent overlay that arrives after load
covers the target the pick found (BBC: 3 of 3 clicks landed on the overlay). While the target is
covered or moving the click is held, polling for up to 1.5 s, then proceeds regardless.

A page-level "settled" gate was tried on top of this (loading cues quiet twice plus a decision-model verdict
over cues and content; offline the most correct load signal measured, 2 premature exits in 40 sites
against 7 for network-quiet itself). Live it refused on exactly the pages readiness would have sped
up and bought no accuracy, so it was dropped: the objective is the least waiting at reasonable
accuracy, and the target guard already carries the accuracy.

Measured (1 trial, Browserbase): act 39/40, breadth 39/40 (unchanged or better); about 60% of
acts go early; caller-side median 1001 → 694 ms on the act suite, and 1118 → 785 ms for the
breadth acts that go early (1012 ms over all breadth acts). The guard refused 12 early acts:
target not there yet (7), covered (3), selector resolving to another node (3).

> > > > > > > 4298bb40f (docs: restore the target-readiness README section dropped in the rebase; regenerate artefacts)

## WebMCP tools (`tools: true`)

The page's tools are listed while `act()` waits for the DOM to settle, and the tool questions ride
in the intent request that every act already makes, so a page without tools adds no question and a
page with tools adds no round trip. Alongside "which tool" (with a "none" option) a guard asks
whether the instruction names a control: "click the Add to cart button" always takes the element
path, even when `add_to_cart` exists. A tool is used only at ≥ 0.8 with "none" ≤ 0.2.

Arguments are picked by the decision model as spans of the instruction (enums and booleans as choices) and accepted
only when every parameter, stated or not, is ≥ 0.8. The argument questions of the two tools whose
names and descriptions share most words with the instruction ride in the same request, so a
confident tool call is usually one request (~300 ms); another winner costs one more. Values that
are not spans (dates to normalise, lists, nested objects) go to an argument-only LLM call that sees
just that tool, with its input schema as the response format; when the schema alone shows the
likely tool will need it, that call starts alongside the decision-model request. Any doubt means the ordinary
act path continues from the intent it already has. Once a tool has been invoked the act is over,
success or error: it never also clicks through the UI. Tool acts are not cached.

```ts
// TypeScript SDK; Chrome needs its WebMCP features on, which localBrowser.launch() does.
process.env.STAGEHAND_EXPERIMENTAL_DECISIONS = JSON.stringify({ apiKey, tools: true });
const stagehand = await Stagehand.create({ browser, model });
await page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/webmcp-test/");

await stagehand.act("add 19 and 23 together");
// → { method: "webmcp", selector: "webmcp:calculateSum", arguments: ['{"a":19,"b":23}'] }
//   message: 'Invoked WebMCP tool calculateSum: {"a":19,"b":23,"sum":42}'   (one decision-model request, no LLM call)

await stagehand.act("click the Calculate button");
// → names a control, so the ordinary element path runs
```

On 380 LLM-written requests over 166 tools harvested from six live sites: tool choice answered by
The decision model for 79% of requests at 99% precision; arguments filled by the decision model for 69% of calls at 98% precision.

## What leaves the process

Sent to the decision provider: the instruction, candidate descriptions built from the accessibility outline
(names, nearby text, card/row text, DOM attributes of nameless controls), the page URL without
query string or fragment, a digest of the first visible content (page state), and — only with
their own opt-ins — extracted data (`extract`) and cached action descriptions (`cacheCheck`).
Resolved `%variable%` values of three or more characters are replaced by their placeholder in every
request and in the trace
log, including when an earlier act already typed them into the page. With the flag on, each act
logs its instruction and a trace of candidate descriptions at info level.

## Known limits

- Decision-model usage is logged but not part of `result.metadata.usage`. With `tools`, an argument LLM call
  started speculatively and not used finishes after the act has returned, and its tokens are not
  counted anywhere.
- Thresholds (0.7 accept, 0.9 none veto, 0.7 held-pick cap) were set on the act and breadth suites.
  The cache-check threshold (0.35) comes from direct API probes; no eval exercises the cache path.
- No eval exercises page-state fail-fast or `retryNoEffect` end to end; both have unit tests only.
- Modifier chords, file upload and unquoted `<select>` options on selects with more than 254
  options go to the LLM.
