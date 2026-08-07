# Protocol

Stagehand uses bidirectional JSON-RPC. “Client” and “server” identify the sender of a message:

| Term                | Direction       | Response expected |
| ------------------- | --------------- | ----------------- |
| Client request      | client → server | yes               |
| Server request      | server → client | yes               |
| Client notification | client → server | no                |
| Server notification | server → client | no                |

`StagehandMethods` contains request/response method contracts, regardless of which side initiates
them. `StagehandNotifications` contains one-way notification contracts. A JSON-RPC notification is
a request object without an `id`, so it does not receive a response.

## How it works

1. `schemas.ts` defines protocol data with Zod.
2. `schema-registry.ts` assigns those schemas to JSON-RPC methods and notifications.
3. `json-rpc/build-json-rpc-schema.ts` derives one in-memory Zod document from those catalogs, converts it to JSON Schema, renames API-facing keys to their wire names, and writes `stagehand.v4.json`.
4. TypeScript uses the original Zod schemas directly. `just generate` uses `stagehand.v4.json` to generate the Python models and Go structs.

## Where schemas go

- Does it cross the JSON-RPC boundary?
  - Put it in `schemas.ts` and infer its type with `z.infer` in `types.ts`.
  - The Zod schema is the source of truth.
- Is it used only by the SDKs?
  - Put it in `../sdk-ts/src/clientSchemas.ts`, `../sdk-python/src/stagehand/client_types.py` and `client_models.py`, and `../sdk-go/client_options.go`.
  - Extend or reuse the protocol type when possible.

## Adding or changing a method

1. Decide which fields cross JSON-RPC and which are used only by the SDKs.
2. Add or update the Zod schemas in `schemas.ts`, export their types with `z.infer` from `types.ts`, and add the method to `StagehandMethods` in `schema-registry.ts`.
3. Run `just generate`.
4. Implement and route the method in the extension.
   - Add it to the appropriate controller in `../extension/controllers`, creating a controller if needed.
   - Put the underlying behavior in the appropriate service in `../extension/services`, then route the method in `../extension/rpcRouter.ts`.
5. Add or update the method in all three SDKs.
   - TypeScript: update the appropriate class in `../sdk-ts/src`.
   - Python: update the corresponding class in `../sdk-python/src/stagehand`.
   - Go: update the corresponding type in `../sdk-go`.
6. Update the matching `../docs/v4/reference/<object>.mdx` page and any affected guide.
7. Add focused tests, then run `just check` and `just test`.

## Runtime protocol versions

Use `protocolVersion` as the only compatibility gate. Bump it only for breaking wire changes:

| Bump for                       | Never bump for      |
| ------------------------------ | ------------------- |
| Renamed or removed parameters  | New methods         |
| Removed or retyped result data | New optional fields |
| Changed notification semantics |                     |
| Transport changes              |                     |

Keep `RuntimeDescriptorSchema` TypeScript-only. The runtime marker is read as a camel-cased JavaScript object through CDP, not through the snake-cased JSON-RPC schema artifact.
