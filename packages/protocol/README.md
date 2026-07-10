# Protocol

Canonical Zod operation schemas, shared protocol metadata, and generated manifest inputs.

1. Define or update method parameter, result, notification, and shared schemas in `schemas.ts`.
2. Register each root method or notification in `schema-registry.ts`; exported schemas alone do not become protocol operations.
3. Add runtime contract tests under `tests/protocol`, or generic JSON-RPC tests under `json-rpc/tests`.
4. Regenerate `stagehand.v4.json` with `vp run -F ./packages/protocol build:schema` from the repository root.
5. Run `vp run -w check` and `vp run -w test` before submitting the change.
