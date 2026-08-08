# Run Stagehand code mode in an E2B sandbox

Use this example when an agent framework runs on your host but Stagehand code mode must execute
untrusted JavaScript behind a microVM boundary.

```text
Your MCP client
  └─ E2B bearer-authenticated Streamable HTTP
       └─ E2B Firecracker microVM
            └─ Stagehand MCP over stdio
                 └─ generated JavaScript + Browserbase browser
```

The E2B package is a private workspace example that exports one framework-neutral contract:

```ts
type StagehandSandboxConnection = {
  url: URL;
  token: string;
  close: () => Promise<void>;
};
```

`createStagehandSandbox()` asks E2B's custom MCP gateway to clone a complete Stagehand commit,
build the code-mode package from source, and start its stdio server. It waits for exactly one
`code_execute` tool, applies the runtime egress policy, and only then returns the HTTP connection.
It does not depend on the Stagehand OCI image.

## Install and run

Set these variables on the host. `BROWSERBASE_PROJECT_ID` is optional. The default CDP allowlist is
the US West host observed in the live proof; set `BROWSERBASE_CDP_HOSTS` to the comma-separated CDP
hostnames returned for your Browserbase region.

```bash
E2B_API_KEY=<e2b-api-key>
BROWSERBASE_API_KEY=<browserbase-api-key>
BROWSERBASE_PROJECT_ID=<optional-browserbase-project-id>
BROWSERBASE_CDP_HOSTS=connect.usw2.browserbase.com
STAGEHAND_REVISION=<40-character-git-commit>

pnpm --filter @browserbasehq/stagehand-integrations-example-e2b e2e
```

## Connect an MCP client

This raw [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk)
example is the adapter boundary that agent frameworks build on:

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createStagehandSandbox } from "@browserbasehq/stagehand-integrations-example-e2b";

const stagehand = await createStagehandSandbox({
  stagehandRevision: process.env.STAGEHAND_REVISION!,
  browserbaseApiKey: process.env.BROWSERBASE_API_KEY!,
  browserbaseProjectId: process.env.BROWSERBASE_PROJECT_ID,
  browserbaseCdpHosts: ["connect.usw2.browserbase.com"],
});
const client = new Client({ name: "my-agent", version: "1.0.0" });
const transport = new StreamableHTTPClientTransport(stagehand.url, {
  requestInit: { headers: { Authorization: `Bearer ${stagehand.token}` } },
});
transport.setProtocolVersion("2025-06-18");

try {
  await client.connect(transport);
  const tools = await client.listTools();
  console.log(tools);
} finally {
  await client.close();
  await stagehand.close();
}
```

E2B's current gateway requires MCP protocol `2025-06-18`. Authentication is the bearer token from
E2B's built-in MCP gateway; this example does not add a second proxy or application-defined secret.

## Network and credential boundary

The source checkout and dependency build need normal package-network access. After readiness succeeds,
`sandbox.updateNetwork()` atomically replaces that permissive setup with an allowlist containing only
`api.browserbase.com` and the configured Browserbase CDP hostnames. In E2B, setting `allowOut` makes
all unlisted egress denied by default. The live proof checks that Browserbase still works while an
unrelated host is blocked.

Browserbase-only egress is the default. AI-backed Stagehand methods require a separately scoped model
credential **and** the model provider's exact API hostname added to the allowlist. Do not forward the
outer agent's model key into the microVM or broaden egress implicitly.

Only the Browserbase key and optional project ID cross the sandbox boundary by default. A complete
commit hash prevents the source install from silently following a moving branch. Always close the MCP
client and call `close()`; the latter kills the complete microVM. Apply a host-side deadline and kill
the microVM when untrusted code stops responding.

See [E2B custom MCP servers](https://e2b.dev/docs/mcp/custom-servers) for gateway and source-install
details.
