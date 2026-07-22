# V4 API Logs

Running log of every friction point found while porting the v3 bench evals
to the Stagehand v4 SDK (local checkout of `browserbase/v4-spike`, linked as
`@browserbasehq/stagehand-v4-spike-sdk-ts`). Each entry notes the impact on
the eval port. This file is a deliverable: score gaps between the v3 and v4
suites should be interpretable against it.

- v4-spike commit at port time: `2689384` (2026-07-21)
- v3 baseline branch: `evals-v4-port` (off `main` @ `84197d8c`)

## API gaps (blocking or workaround-required)

### 1. `act()` accepts a string only — no observe→act replay
v3 supports `v3.act(observeResult)` to deterministically replay an action
planned by `observe()` (the cache-then-act pattern). v4's
`page.act(input: string, options?)` has no counterpart; `ReplayActionSchema`
exists in `packages/protocol/pending-schemas.ts` but is unimplemented.
**Impact:** every observe task that replays observations (at least
`observe_simple_google_search`, `observe_amazon_add_to_cart`,
`observe_main_frame_element_ids`). The ported
`observe_simple_google_search` re-implements a minimal replay via locators
(documented in-file); this mirrors v3's internal `performPlaywrightMethod`
semantics but is consumer-side code that the SDK should own.

### 2. `extract()` requires a schema
v3 supports `v3.extract(instruction)` with no schema, returning
`{ extraction: string }`. v4's `page.extract(instruction, schema, options?)`
makes the schema parameter mandatory.
**Impact:** any task using schemaless extraction must either be skipped or
ported with an explicit `z.object({ extraction: z.string() })` — the latter
changes what the LLM is asked to produce, so it is not behavior-preserving.
Flag per task during the full port.

### 3. `Locator` has no `backendNodeId()`
v3 evals assert element identity by comparing `backendNodeId`s between an
observed selector and known-good selectors (e.g. `observe_yc_startup`). The
v4 `Locator` exposes no node identity.
**Impact:** ported tasks re-express identity checks via `page.evaluate`
(resolve both selectors in-page, compare element references). Same
criterion, but clunkier and main-frame-only.

### 4. No logger injection
`new Stagehand(...)` accepts no logger; SDK notifications go directly to
`console.debug/info/warn/error` (`sdk-ts/src/stagehand.ts`,
`renderStagehandNotification`). v3 evals capture per-task logs through
`EvalLogger` and attach them to results.
**Impact:** v4 task results carry only task-level logs; SDK-internal logs
are not captured in eval output.

### 5. No debugger URL for Browserbase sessions
The SDK exposes `browserbaseSessionId` (via `stagehand.browser`) but no
debug/inspector URL (v3: `v3.browserbaseDebugURL`). The eval harness
constructs the session URL from the ID; `debugUrl` is left empty for v4
runs.

### 6. `goto()` returns a page ref, not a Response
No status-code or response assertions are possible after navigation
(v3/Playwright: `const res = await page.goto(...); res.status()`).
**Impact:** flag per task during the full port.

### 13. v3 and v4 cannot coexist in one process: 28 zod global-registry ID collisions
The headline finding of the smoke phase. v3 core and the v4 protocol both
register the **same 28 zod schema IDs** via `.meta({ id: ... })` — e.g.
`VariablePrimitive`, `ActResult`, `ExtractOptions`, `ObserveResult`
(v3: `core/lib/v3/types/public/*.ts`, v4: `packages/protocol/schemas.ts`).
zod keeps one registry per process (`globalThis.__zod_globalRegistry`),
shared across every zod copy and version. zod ≤4.2.x's `add()` throws on a
duplicate ID, so importing the v4 SDK into any process that already loaded
v3 core crashed with `ID VariablePrimitive already exists in the registry`
— exactly what a migration-period consumer (or this regression harness)
does. v4-spike never sees this internally because zod ≥4.3 silently
overwrites duplicates instead of throwing.

**Impact:** first harness run of a v4 task failed at `initV4` import time;
standalone v4 usage (no v3 in-process) worked fine, which is why the SDK's
own examples/tests don't catch it.
**Interim resolution (2026-07-22):** unified core + evals on zod 4.4.3 so
the process-wide registry is created by a tolerant (last-wins) `add()`.
Verified empirically: `act/dropdown` passes through the harness on both
`--sdk v3` and `--sdk v4` after unification. Note this only downgrades the
bug from crash to silent overwrite — v4's registrations now replace v3's
entries in the shared ID map.
**Recommendation for the v4 team (raised with them 2026-07-22):**
namespace the protocol's IDs (e.g. `StagehandV4.ActResult`) or register
into a scoped `z.registry()` instead of `globalRegistry`, so the SDK can
coexist with v3-based code in one process regardless of the consumer's zod
version.

### 14. extract() mangles snake_case schema keys (wire-casing bug)
Extract schemas whose property names are snake_case fail on v4 with an
OpenAI structured-outputs rejection. Reproduced standalone with the
`extract_aigrant_targeted` schema (`{ company_name: z.string() }`):

    Invalid schema for response_format 'Extraction': In context=(),
    'required' is required to be supplied and to be an array including
    every key in properties. Missing 'companyName'.

The protocol's wire-casing layer (`packages/protocol/json-rpc/
wire-casing.ts`, camelcase-keys/snakecase-keys) re-cases JSON crossing the
RPC boundary and appears to rename the user schema's `properties` keys
without updating the `required` array (or vice versa), producing an
internally inconsistent JSON schema. User-supplied schema keys are data,
not protocol fields — they must be exempt from wire re-casing.
**Impact:** every extract task with snake_case keys fails on v4 in both
LOCAL and BROWSERBASE (`extract_aigrant_targeted`,
`extract_github_commits` in the smoke slice; many more in the full suite
use snake_case). Schemas with single-word keys (`extract_apartments`)
pass through unharmed, which can mask the bug in casual testing.

### 15. observe() element choice diverges from v3 on container-selection tasks
`observe_yc_startup` (find the container holding all company entries):
v3's observation matches the known-good container in both environments;
v4 consistently returns a *plausible but different* element
(`xpath=/html[1]/body[1]/div[1]/div[3]/div[1]/div[1]/div[2]/div[2]/div[4]`)
that is not the results container. 1-trial evidence from both LOCAL and
BROWSERBASE; needs trials to quantify, but the consistency across envs
suggests a systematic difference in how v4's observe ranks container
candidates rather than sampling noise. Also note v4 returns indexed
absolute XPaths (`/html[1]/body[1]/...`) where v3 returned other selector
forms — any consumer code pattern-matching selectors will notice.

## Ergonomic friction (non-blocking)

### 7. Result/param types are not exported
`page.observe()` returns `Action[]` and `page.act()` returns
`ActResultData`, but neither type is re-exported from the SDK's index —
consumers must derive them (e.g.
`Awaited<ReturnType<Page["observe"]>>[number]`).

### 8. zod version seam at the extract boundary
`page.extract()` calls `z.toJSONSchema()` (SDK's zod, 4.4.3) on schema
objects constructed by the consumer. No version or instance guard exists at
the boundary; a mismatch would be silent. Suggestion for the v4 team:
validate/normalize incoming schemas at the API boundary.
**Resolution for this port:** core + evals were unified on zod 4.4.3
(2026-07-22, see #13 for the forcing incident), so both sides of the
boundary now run identical zod versions. Typechecking with mixed versions
had already failed loudly (4.2.1 `ZodObject` lacks `with`/`exactOptional`/
`apply` vs 4.4.3's `ZodType`), confirming the drift was real.

### 9. Previously-sync accessors are now async RPCs
`context.pages()`, `page.url()`, `page.title()` are all async in v4
(each is a websocket round-trip). Port-wide mechanical churn; also means
URL assertions observe the page at a slightly different moment than v3's
sync accessors did.

### 10. `extract` `options.selector` is documented CSS-only
v3 targeted-extract tasks pass bare XPaths as `selector` (e.g.
`extract_aigrant_targeted`: `/html/body/div/ul[5]/li[28]`). v4's
`ExtractOptions.selector` is documented as "CSS selector to scope
extraction". Ported verbatim; smoke run will show whether XPath works,
is ignored, or errors.

### 11. `xpath=`-prefixed selectors in `page.locator()` unverified
v3 tasks use Playwright's `xpath=/html/...` locator syntax. v4 locators
resolve server-side with no documented selector-engine contract. Ported
verbatim; smoke run will verify.

### 12. No reference docs in the repo
v4-spike ships no `docs/`; the only usage references are
`packages/sdk-ts/examples/` (act, extract, observe, caching, custom-llm)
and the SDK source itself.

## Open questions (to resolve during smoke)

- Local-run parity: v3 evals launch local Chromium headful
  (`initV3.ts` `headless: false` default); `initV4` matches. Confirm the
  v4 extension-based driver behaves identically headful vs headless.
- Model API keys must be passed explicitly into init params (the LLM runs
  inside the browser extension and cannot read process env). Verify
  per-provider key routing works for all three smoke models.
