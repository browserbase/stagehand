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
4. TypeScript uses the original Zod schemas directly. Other SDKs and documentation consume `stagehand.v4.json`.

## Adding a method

Follow these steps to add a method to the protocol:

1. Define the method's Zod parameter and result schemas in `schemas.ts`, including a stable `.meta({ id: "..." })` on each new schema.
2. Export their inferred types from `types.ts`.
3. Add the method definition to `StagehandMethods` in `schema-registry.ts`.
4. Implement the method in the appropriate server controller.
5. Route the method to that controller in `../server/rpcRouter.ts`.
6. Expose the method from the appropriate TypeScript SDK class using `client.send(StagehandMethods.example, params)`.
7. Add protocol, server, and SDK tests for the method.
8. Regenerate `stagehand.v4.json` with `vp run -w build:schema`, then run `vp run -w check` and `vp run -w test` from the repository root.
