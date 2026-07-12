# Protocol

Canonical Zod operation schemas, shared protocol metadata, and generated manifest inputs.
Always import zod objects from schemas.ts and the corresponding type from types.ts.

1. Define or update method parameter, result, notification, and shared schemas in `schemas.ts`.
2. Add the matching output type to the adjacent `types.ts` as `z.infer<typeof ExampleSchema>`.
3. Register each root method or notification in `schema-registry.ts`; exported schemas alone do not become protocol operations.
4. Add runtime contract tests under `tests/protocol`, or generic JSON-RPC tests under `json-rpc/tests`.
5. Regenerate `stagehand.v4.json` with `vp run -F ./packages/protocol build:schema` from the repository root.
6. Run `vp run -w check` and `vp run -w test` before submitting the change.
