# Observation fixture recorder

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

This is an observation fixture on-ramp, not an arbitrary application recorder.
It supports manually authored `extract()` / `observe()` regressions against a
frozen observation. It does not generate assertions or replay click handlers,
fetches, navigation, authentication, or state transitions. Network response
recording and bug-report automation are future work. The issue's old
`tasks/extract` and `tasks/observe` live-site tasks are absent from current v4
`main`, so migrating those tasks is not part of this change.

## Record

From the repository root, after installing workspace dependencies:

```sh
pnpm --filter @browserbasehq/stagehand-evals exec playwright install chromium
pnpm --filter @browserbasehq/stagehand-evals fixture:record \
  --url https://example.com --out /tmp/example-fixture
```

The output directory must not exist; its parent must exist. Existing fixtures
are never overwritten. Refresh into a new directory, compare, and explicitly
replace the reviewed fixture. Capture metadata records the final URL, timestamp,
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
a dedicated fixture; always validate the original failure against the result.

## Tests

```sh
cd packages/evals
pnpm exec vitest run --config vitest.integration.config.ts tests/integration/fixtureRecorder.test.ts
```

Tests use a local server and Chromium to cover edited form state, accessible
content, hidden content, resolved links, offline replay, existing-output
protection, and rejection of frames and open shadow DOM. No cloud browser or
model calls are required.

## Validated Stagehand regression: extraction schema keys (#2624)

`tests/integration/fixtureExtraction.test.ts` exercises the real Stagehand SDK,
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
pnpm exec vitest run --config vitest.integration.config.ts tests/integration/fixtureExtraction.test.ts
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
