# Playwright DOM semantics

Pinned upstream: [Playwright v1.64.1](https://github.com/microsoft/playwright/tree/cfe490d941f992655948eee8fd4fd94e1c4234bf), commit `cfe490d941f992655948eee8fd4fd94e1c4234bf`.

These five runtime files provide accessible roles/names, ARIA states, text extraction, and whitespace handling for Stagehand's semantic locators. They intentionally retain upstream behavior. The only code adaptations are relative import paths and one explicit `number[]` annotation for an empty array that our TypeScript configuration otherwise infers as `never[]`. The LICENSE file's CRLF line endings are normalized to LF. `provenance.json` records these reversible changes and SHA-256 hashes of the original upstream files. `types.ts` contains the exact upstream type declarations needed by those imports, without bringing in unrelated selector or YAML parsers.

Do not refactor or reformat these files independently. In particular, `roleUtils.ts` remains above 1,000 lines because preserving the upstream accessibility algorithm intact makes updates auditable; splitting or rewriting it would create a maintained fork. Stagehand's query orchestration lives outside this directory in `semanticSelectors.ts`.

To update: select an upstream release, refresh these sources and type excerpts, apply only the listed import substitutions and type annotation, update the source hashes, and run the semantic-locator parity tests against the same Playwright version. Changes to the adapter must be reviewed separately from the vendor refresh.

Playwright sources are Apache-2.0 licensed; see `LICENSE` and `NOTICE`. The CSS tokenizer has its own CC0 notice, preserved in its source header. Keep these notices with distributed extension artifacts.
