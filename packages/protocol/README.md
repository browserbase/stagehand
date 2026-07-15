If you want to add a new method to the protocol, follow these steps:

1. Define the method's Zod parameter and result schemas in `schemas.ts`.
2. Export their inferred types from `types.ts`.
3. Add the method definition to `StagehandRPC` in `schema-registry.ts`.
4. Implement the method in the appropriate server controller.
5. Route the method to that controller in `../server/rpcRouter.ts`.
6. Expose the method from the appropriate TypeScript SDK class using `client.send(StagehandRPC.example, params)`.
7. Add protocol, server, and SDK tests for the method.
8. Regenerate `stagehand.v4.json` with `vp run -w build:schema`, then run `vp run -w check` and `vp run -w test` from the repository root.
