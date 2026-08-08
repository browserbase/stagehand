# Eve with Stagehand code mode

This example gives an Eve agent one browser tool, `stagehand__code_execute`, without running
generated JavaScript in the Eve process. Eve stays on the host while the package-installed
[Vercel Sandbox example](../vercel-sandbox) owns Stagehand, the browser session, and generated code:

```text
Eve connection_search -> authenticated Streamable HTTP -> Vercel Sandbox -> Stagehand MCP
                                                                        `-> generated JavaScript
```

[`agent/connections/stagehand.ts`](./agent/connections/stagehand.ts) is the complete framework
adapter. It receives the shared sandbox `{ url, token }`, uses Eve's native
`defineMcpClientConnection`, and allows only `code_execute`. Eve qualifies the discovered tool as
`stagehand__code_execute`; the canonical Stagehand guidance stays in the MCP tool description.

## Dependency version

The example pins Eve 0.29.4, the newest release old enough for this repository's dependency-age
policy when the integration was validated. Eve is pre-1.0 and its public API is still evolving, so
upgrade this pin only with the contract and live proofs below.

## Secret-free framework contract

From the repository root:

```bash
pnpm install
pnpm --filter @browserbasehq/stagehand-integrations-example-eve typecheck
pnpm --filter @browserbasehq/stagehand-integrations-example-eve contract
```

The contract starts an authenticated MCP server built on the official MCP SDK, deliberately returns
405 for the optional GET stream, and runs the real Eve build, server, and eval runtime with a
deterministic model. The eval must:

1. use `connection_search` exactly once;
2. discover only `stagehand__code_execute`;
3. call it exactly twice through one connection;
4. receive persistent-page-shaped results and the exact expected markers; and
5. reject an unauthenticated request while tolerating authenticated GET 405.

This proves Eve's connection behavior without claiming browser or sandbox isolation.

## Live package-backed proof

Build and pack the exact Stagehand packages under review, then run the live composition:

```bash
pnpm exec turbo run build --filter @browserbasehq/stagehand-codemode
pnpm --filter @browserbasehq/stagehand-integrations-example-vercel-sandbox pack:artifacts

STAGEHAND_SANDBOX_ARTIFACTS="$PWD/packages/integrations/examples/vercel-sandbox/.artifacts" \
BROWSERBASE_API_KEY=<api-key> \
BROWSERBASE_PROJECT_ID=<project-id> \
VERCEL_OIDC_TOKEN=<oidc-token> \
OPENAI_API_KEY=<openai-key> \
pnpm --filter @browserbasehq/stagehand-integrations-example-eve e2e
```

For external CI, replace `VERCEL_OIDC_TOKEN` with `VERCEL_TEAM_ID`, `VERCEL_PROJECT_ID`, and
`VERCEL_TOKEN`. `EVE_STAGEHAND_MODEL` selects the direct OpenAI model and defaults to
`gpt-5-mini`.

The live proof checks unauthenticated 401 and authenticated optional-GET 405, then runs both the
deterministic and real-model Eve evals against one package-installed Vercel Sandbox connection.
Each eval must discover the connection, make two `code_execute` calls, retain a DOM marker between
calls, and observe neither `OPENAI_API_KEY` nor a host-only marker inside generated code. `PASS` is
emitted only after the Eve runtimes stop and the sandbox is destroyed.
