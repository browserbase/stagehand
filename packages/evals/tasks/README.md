# Observation task recorder

This implements the static observation tier proposed in
[issue #2841](https://github.com/browserbase/stagehand/issues/2841). The
[discussion](https://github.com/browserbase/stagehand/issues/2841#issuecomment-5870055043)
distinguishes observation snapshots from network recordings needed for dynamic
`act()` regressions. There is no maintainer answer in that discussion yet.

## Scope and implementation plan

1. Capture the rendered DOM in a local Chromium session after optional setup.
2. Produce a standalone `index.html` and versioned `manifest.json`, preserving
   computed styles, resolved link destinations, and current form state.
3. Remove executable content and remote asset references; use a restrictive CSP
   so passive replay cannot silently depend on the original site.
4. Test using a local HTTP source and actual Chromium, without LLM credentials.

This is an observation task on-ramp, not an arbitrary application recorder.
It supports manually authored `extract()` / `observe()` regressions against a
frozen observation. It does not generate assertions or replay click handlers,
fetches, navigation, authentication, or state transitions. Network response
recording and bug-report automation are future work. Current extraction and
observation benchmarks live under `tasks/bench/extract` and `tasks/bench/observe`.
The existing-eval validation below covers three tasks migrated to saved pages.

## Record

From the repository root, after installing workspace dependencies:

```sh
pnpm --filter @browserbasehq/stagehand-evals exec playwright install chromium
pnpm --filter @browserbasehq/stagehand-evals task:record \
  --url https://example.com --out /tmp/example-task
```

The output directory must not exist; its parent must exist. Existing tasks
are never overwritten. Refresh into a new directory, compare, and explicitly
replace the reviewed task. Capture metadata records the final URL, timestamp,
and viewport (1280 × 720).

For a hydrated page or a specific UI state, pass `--setup /absolute/path/setup.ts`.
This is trusted local code, executed with your process's permissions:

```ts
import type { Page } from "playwright";

export default async function setup(page: Page) {
  await page.getByRole("button", { name: "Show details" }).click();
  await page.getByRole("heading", { name: "Details" }).waitFor();
}
```

Capture waits for page load and the setup function. There is no generic guarantee
that an application is settled; use explicit readiness assertions in setup.
The recorder uses a fresh browser context with service workers disabled and
closes the browser even when setup or capture fails.

## Replay and review

Serve the directory with any static HTTP server and point an eval at its
`index.html`. Use the recorded viewport. Write an exact expected extraction or
observation assertion, verify it reproduces the original failure, then verify
the fix against that assertion. The artifact is ordinary HTML and can be hosted
alongside existing mirrors; this tool does not publish it.

Links retain their original absolute destinations for extraction. Do not click
links during observation replay: top-level navigation is not blocked by CSP.
For strict offline tests, additionally abort network requests in the test browser.

Review captured HTML and metadata before committing: source URLs, visible text,
hidden DOM, and non-password form fields may contain private data. Password and
file input values are omitted, but this is not a general-purpose redactor.
Review third-party content permissions and artifact size as well.

Frames and open shadow roots fail capture explicitly. Closed shadow roots cannot
be detected by this DOM serializer. Images, fonts, pseudo-element content,
canvas pixels, media, animations, and application behavior are not preserved.
Computed styles preserve much of the rendered layout and visibility, but do not
guarantee pixel or accessibility-tree equivalence. Keep these cases live or build
a dedicated task; always validate the original failure against the result.

## Tests

```sh
cd packages/evals
pnpm exec vitest run --config vitest.integration.config.ts tests/integration/taskRecorder.test.ts
```

Tests use a local server and Chromium to cover edited form state, accessible
content, hidden content, resolved links, offline replay, existing-output
protection, and rejection of frames and open shadow DOM. No cloud browser or
model calls are required.

## Validated Stagehand regression: extraction schema keys (#2624)

`tests/integration/taskExtraction.test.ts` exercises the real Stagehand SDK,
Chrome extension, DOM snapshot, model callback, and extraction result against both
an interactive source page and the recorder's saved HTML. The source is an
explicitly reduced reproduction of the confirmed historical bug in
[PR #2624](https://github.com/browserbase/stagehand/pull/2624), not an archived
reporter's website. Its HTML lives in `examples/schema-keys.html`.

The test clicks “Load company” before recording, then extracts `company_name` and
`employee_count`. A deterministic `ClientLLM` adapter checks the schema received
from the extension and reads the company values from the actual observation
prompt. It also supplies the extraction-completion response. No paid model or
Browserbase session is involved. Assertions verify:

- Both source and recorded pages extract `{ company_name: "Acme Labs", employee_count: 42 }`.
- The model receives the original snake_case properties and aligned required keys.
- The complete extraction prompts match after normalizing session-local element IDs.

Run from `packages/evals` after building the SDK and extension:

```sh
pnpm exec vitest run --config vitest.integration.config.ts tests/integration/taskExtraction.test.ts
```

### Negative-control experiment

The bug is already fixed on `main`. To establish that this is a regression test,
we temporarily restored the historical faulty line in
`packages/protocol/schema-registry.ts`:

```ts
// Faulty aggregate request decoder:
params: wireSchema(method.params),

// Existing upstream fix:
params: wireSchema(method.params, "paramsWire" in method ? method.paramsWire : undefined),
```

We rebuilt the extension and ran the two extraction tests against that build.
**Both failed:** the model received `companyName` and `employeeCount`. Restoring
the original line and rebuilding makes both extractions and the prompt-equality
assertion pass. The faulty code is not retained in this change.

This establishes source → recording → failing Stagehand assertion → existing fix
→ passing assertion for one real transport regression. It does not establish
model reasoning quality or preservation of every browser observation. In
particular, this bug is schema transport related, so it is a baseline validation
of the workflow rather than proof for layout, shadow DOM, or dynamic `act()` bugs.

## DOM-sensitive observation fidelity

`tests/integration/taskObservation.test.ts` validates a synthetic checkout page
in `examples/checkout.html` through real `stagehand.observe()` calls. It tests
capture fidelity directly, independently of the schema-transport regression above.

An external stylesheet hides a misleading cancel control. Setup edits an input
value, checks a checkbox, selects shipping, expands native `<details>`, and changes
the submit button's accessible name through a hidden `aria-labelledby` target.
The recorder captures this settled state. The test then disables the original
page and stylesheet endpoints before replaying the saved HTML.

Assertions verify that:

- Source and recorded observation prompts match after normalizing element IDs.
- The dynamically named submit button remains observable, while the CSS-hidden
  control stays absent from the model input.
- The returned XPath resolves to the intended, visible submit button.
- Edited input, checkbox, selected option, and expanded details state survive.
- Replay requests only the task document, with no source or stylesheet fetch.

The deterministic model adapter chooses an element ID from Stagehand's actual
observation and returns it through the normal inference pipeline. It does not
substitute for browser capture or selector resolution, and needs no API key.

A negative control deliberately removes the captured visibility style. This
exposes the hidden control in Stagehand's model input, and the observation check
rejects the lossy task. It proves the validation detects this specific capture
loss. This is a synthetic capture-fidelity regression, not a claim to reproduce a
historical Stagehand bug or prove general model reasoning quality.

Run all recorder validations from `packages/evals`:

```sh
pnpm exec vitest run --config vitest.integration.config.ts tests/integration/task*.test.ts
```

## Existing-eval migrations

Seven benchmarks now use six recordings in `assets/observation-tasks`:

| Existing task                | Preserved check                                                  |
| ---------------------------- | ---------------------------------------------------------------- |
| `extract_aigrant_targeted`   | Extract Coframe within the original XPath                        |
| `extract_aigrant_targeted_2` | Keep neighboring OpusClip outside that XPath                     |
| `observe_file_uploads`       | Resolve the observed selector to the expected file input         |
| `extract_csa`                | Extract the publication list and its expected first/last entries |
| `extract_professional_info`  | Extract the practices, phone, and fax                            |
| `extract_resistor_info`      | Extract lead time, tolerance, resistance, and temperature        |
| `ionwave_observe`            | Resolve an observed element to the expected registration link    |

The instructions, schemas, selectors, and scoring assertions are unchanged.
All 37 extraction/observation tasks were audited. See the [eligibility audit](../assets/observation-tasks/AUDIT.md)
for every decision, including unsupported pages, required interactions, capture
fidelity failures, and broken source baselines. All candidates that passed the
fidelity checks are included; excluded tasks retain their existing live behavior.

`tasks/replay.ts` restores each recorded viewport and sends the HTML through the
normal SDK page API. It needs no recording server reachable by a remote browser.
Gzip reduces the repeated computed styles; the eval build copies these assets to
`dist/esm/assets`. Manifests include provenance and uncompressed HTML SHA-256.

`tests/integration/taskExistingEvals.test.ts` runs the actual task functions.
Offline tests use deterministic model adapters: the initial three exercise the
original assertions; the four additions inspect real Stagehand prompts for
required source content and stop at the inference boundary. Paid model tests
check the original scoring assertions for all seven tasks. Local offline runs
block external DNS, and the recording CSP blocks remote page assets. A negative
control removes company text and requires validation to reject the altered page.
Manifest checks cover all six recordings.

`pnpm test:browser` includes the offline checks in root `just test` and the
TypeScript browser CI job, including eval-only changes. Its explicit test filter
excludes opt-in suites even when their environment flags are set.

After building the SDK and extension, run from `packages/evals` (install Playwright
Chromium for the optional frame-rejection check):

```sh
# Offline replay: no provider credentials or original websites needed.
pnpm test:browser

# Compare the committed recordings with current public source pages.
VALIDATE_EXISTING_EVAL_TASKS=1 pnpm exec vitest run \
  --config vitest.integration.config.ts tests/integration/taskExistingEvals.test.ts

# Cloud replay: seven comparisons, fourteen Browserbase sessions.
# Set BROWSERBASE_API_KEY first; no model key is needed.
TASK_VALIDATION_BROWSERBASE=1 pnpm exec vitest run \
  --config vitest.integration.config.ts tests/integration/taskExistingEvals.test.ts -t Browserbase

# Paid model validation: three source/recording pairs per task.
# Set OPENAI_API_KEY first; use any supported OpenAI model.
TASK_VALIDATION_MODEL=openai/gpt-5.4-mini pnpm exec vitest run \
  --config vitest.integration.config.ts tests/integration/taskExistingEvals.test.ts -t real-model
```

Source comparisons normalize session-local element IDs, whitespace-only text
nodes, and blank link names; nonempty text, other roles, hierarchy, and values
remain intact. These checks stay opt-in because source changes can legitimately
fail them. Three real-model repeats check practical behavior, not a statistical
guarantee for every model or future SDK version. See the
[asset notes](../assets/observation-tasks/README.md) for provenance and refresh instructions.
