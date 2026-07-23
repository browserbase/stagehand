/**
 * Test stub for the unpublished `@browserbasehq/stagehand-v4-spike-sdk-ts`.
 *
 * The v4 SDK lives in the sibling `v4-spike` checkout as raw TypeScript,
 * linked via `link:`. Unit tests exercise harness mechanics (surface/profile
 * resolution, planning, CLI parsing, discovery, exposure dispatch) — not the
 * real browser SDK — and the linked package cannot be imported at runtime
 * under vitest anyway (it resolves to the type-only `.v4-sdk-types` shim, and
 * it lives outside the repo root so vite's resolver rejects it).
 *
 * This stub lets modules that transitively import the SDK (initV4.ts,
 * core/tools/v4_code.ts) load during the unit run. Anything that actually
 * drives a v4 browser belongs in tests/integration (excluded from `vitest`),
 * or in Stack 1's controller tests, which inject fakes and never import this
 * package. Constructing the stub Stagehand throws, so an accidental real
 * init in a unit test fails loudly rather than silently no-op'ing.
 */
export class Stagehand {
  constructor() {
    throw new Error(
      "v4 SDK stub: the real Stagehand is unavailable in unit tests. " +
        "Move browser-driving tests to tests/integration or inject a fake.",
    );
  }
}

export class BrowserContext {}
export class Page {}
export class Locator {}
export class BrowserClipboard {}
