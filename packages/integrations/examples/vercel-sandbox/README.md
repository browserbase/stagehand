# Run Stagehand code mode in Vercel Sandbox

Use this example when an agent framework runs on your host but Stagehand code mode must execute
untrusted JavaScript behind a microVM boundary.

```text
Your MCP client
  └─ bearer-authenticated Streamable HTTP
       └─ Vercel Sandbox exposed port
            └─ SHA-256 auth proxy (stagehand-proxy user)
                 └─ stateful HTTP-to-stdio bridge (stagehand-mcp user)
                      └─ Stagehand MCP over stdio
                           └─ generated JavaScript + Browserbase browser
```

The private workspace package exports one framework-neutral contract:

```ts
type StagehandSandboxConnection = {
  url: URL;
  token: string;
  close: () => Promise<void>;
};
```

`createStagehandSandbox()` creates a fresh Vercel Firecracker microVM with open setup egress, checks
out a complete Stagehand commit, installs its frozen lockfile, builds code mode from source, and
installs the pinned HTTP-to-stdio bridge. Before the MCP server starts, it replaces setup egress with
an allowlist containing only Browserbase's API and the regional CDP hostname discovered for the
configured project.

## Install and run

Authenticate the host for [Vercel Sandbox](https://vercel.com/docs/vercel-sandbox), then set:

```bash
STAGEHAND_REVISION=<40-character-stagehand-commit>
BROWSERBASE_API_KEY=<browserbase-api-key>
BROWSERBASE_PROJECT_ID=<browserbase-project-id>

pnpm --filter @browserbasehq/stagehand-integrations-example-vercel-sandbox e2e
```

The revision must be a full commit hash. This prevents the trusted install from following a moving
branch or tag. Vercel's credential-brokering header transforms are currently available on Pro and
Enterprise plans. Check the
[credential-brokering announcement](https://vercel.com/changelog/safely-inject-credentials-in-http-headers-with-vercel-sandbox)
before relying on this example with another plan.

Vercel credentials authenticate the host to the Sandbox control plane so it can create, update,
stop, and delete the microVM. They are separate from the random application bearer returned by this
helper, which protects only the MCP port exposed by this sandbox.

## Connect an MCP client

This raw [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk)
example is the adapter boundary that agent frameworks build on:

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  createStagehandSandbox,
  stagehandTransport,
} from "@browserbasehq/stagehand-integrations-example-vercel-sandbox";

const stagehand = await createStagehandSandbox({
  stagehandRevision: process.env.STAGEHAND_REVISION!,
  browserbaseApiKey: process.env.BROWSERBASE_API_KEY!,
  browserbaseProjectId: process.env.BROWSERBASE_PROJECT_ID!,
});
const client = new Client({ name: "my-agent", version: "1.0.0" });

try {
  await client.connect(stagehandTransport(stagehand));
  const tools = await client.listTools();
  console.log(tools);
} finally {
  await client.close();
  await stagehand.close();
}
```

Create one external MCP client and one MCP session per sandbox. The bridge holds one Stagehand stdio
process for that session, so browser pages, DOM changes, cookies, and guest files survive across tool
calls. Destroy the sandbox after the agent run; generated JavaScript can mutate its guest filesystem,
so reconnecting or reusing that VM would cross a trust boundary.

The authenticated `/mcp` endpoint accepts POST and DELETE. It returns `405 Method Not Allowed` for
the optional standalone GET event stream because Vercel's public edge buffers an idle SSE response
and Stagehand does not send server-initiated notifications. MCP calls still stream their responses
over POST.

## Use the cross-language lease

Python and other non-Node adapters can launch the same provider implementation without copying its
setup or network-policy logic:

```bash
node packages/integrations/examples/vercel-sandbox/src/lease.ts
```

The launcher writes exactly one JSON line to stdout:

```json
{ "url": "https://<sandbox-domain>/mcp", "token": "<bearer-token>" }
```

It then holds stdin open as the sandbox lease. Keep the process and stdin pipe alive for the entire
MCP session. Close stdin for normal cleanup; `SIGINT` and `SIGTERM` trigger bounded cleanup and retain
signal-style exit semantics. Spawn it with an explicit environment allowlist containing only the
runtime variables it needs: `PATH`, the relevant Vercel authentication variables,
`STAGEHAND_REVISION`, `BROWSERBASE_API_KEY`, and `BROWSERBASE_PROJECT_ID`. The token is emitted once
over the trusted parent pipe and is never placed in command arguments or environment variables.

## Security boundary

[Vercel Sandbox](https://vercel.com/sandbox) supplies the microVM boundary. Process users are an
additional defense inside that VM, not a substitute for it:

- `stagehand-mcp` runs supergateway, the Stagehand stdio server, and generated JavaScript without
  sudo.
- `stagehand-proxy` runs only the exposed-port auth proxy without sudo. Its bootstrap environment
  receives the SHA-256 digest of a random 32-byte bearer, not the raw bearer.
- The host retains the raw bearer and Browserbase key. The guest MCP process receives a fixed
  placeholder key. Vercel's [credential-brokering transform](https://vercel.com/changelog/safely-inject-credentials-in-http-headers-with-vercel-sandbox)
  overwrites the Browserbase API header at the network boundary.
- The host discovers and validates the exact regional Browserbase CDP hostname before lockdown. The
  running VM allows only that hostname and `api.browserbase.com`; all other egress is denied.
- Source, dependencies, and bridge code become root-owned and read-only before untrusted code runs.
- The only published guest port is the authenticated proxy. The stateful bridge listens on guest
  loopback.

Credential brokering prevents key disclosure, but it still grants the sandbox the Browserbase API
capabilities of that key. Use a separately scoped project/key and host-side timeouts. AI-backed
Stagehand methods require a separately scoped model credential and an exact provider-host policy;
this example intentionally does not forward outer-agent model keys or broaden egress.

The Vercel policy constrains network requests made by guest processes. The browser itself runs
remotely on Browserbase, so this policy does not restrict which URLs that browser can navigate to.
Apply separate browser-navigation controls when the agent must stay within an approved site set.

`close()` is idempotent and attempts both stop and permanent delete even when one cleanup operation
fails. The lease adds a bounded fallback. Always close the MCP client first, then the connection.
