# Eve + Stagehand code mode

Eve accepts remote Streamable HTTP or SSE MCP connections. It does not launch stdio MCP servers
directly. This example keeps the Eve host outside the execution boundary and puts the unchanged
Stagehand stdio server, its browser session, and a small HTTP adapter inside a sandbox.

```text
Eve host
   |
   | Streamable HTTP + bearer token
   v
Firecracker or gVisor sandbox
   |-- authenticated proxy
   `-- supergateway (non-first-party)
          |
          | stdio
          v
       Stagehand code-mode MCP
          |
          v
       generated JavaScript
```

The process boundary between `supergateway` and Stagehand is not the security boundary. Generated
JavaScript inherits the MCP process's filesystem, environment, and network. The Firecracker
microVM or gVisor sandbox is the boundary that protects the Eve host.

## Configure the Eve connection

[`agent/connections/stagehand.ts`](./agent/connections/stagehand.ts) is the complete Eve connection:

```ts
import { defineMcpClientConnection } from "eve/connections";

export default defineMcpClientConnection({
  url: process.env.STAGEHAND_MCP_URL!,
  description:
    "Stagehand browser automation isolated behind an authenticated code-mode MCP gateway.",
  auth: {
    getToken: async () => ({ token: process.env.STAGEHAND_MCP_TOKEN! }),
  },
  tools: { allow: ["code_execute"] },
});
```

Eve discovers the connection through `connection_search`. The only remote tool it can reveal is
`stagehand__code_execute`.

## Start the sandbox

The proposed image name is `ghcr.io/browserbase/stagehand-codemode`. The foundation workflow builds
the image and verifies stdio tool discovery locally; the registry reference becomes available only
after a tag or manual publish workflow runs. Keep the image configurable and, once published, pin
the deployment to an immutable digest:

```text
STAGEHAND_CODEMODE_IMAGE=ghcr.io/browserbase/stagehand-codemode@sha256:<published-digest>
```

[`src/sandbox.ts`](./src/sandbox.ts) defines the provider contract and lifecycle used by the host.
The sandbox adapter must turn `stdioImage` into a command inside the guest. It can mirror the OCI
image into the sandbox root filesystem, or use a guest container runtime and return this command:

```ts
{
  command: "docker",
  args: [
    "run", "--rm", "-i",
    "ghcr.io/browserbase/stagehand-codemode@sha256:<published-digest>",
  ],
}
```

The image itself contains only the Stagehand stdio MCP. It does **not** contain the HTTP gateway.
The trusted host bootstrap writes [`src/sandbox-guest.mjs`](./src/sandbox-guest.mjs) into the
Firecracker or gVisor guest, installs `supergateway@3.4.3` there, and starts the authenticated
proxy. `supergateway` then owns the image command as its stdio child. Pass an adapter that can write
a file, spawn a process, publish a port, and destroy the sandbox; then give the result to Eve:

```ts
import { createStagehandSandboxGateway } from "./src/sandbox.js";

const stagehand = await createStagehandSandboxGateway(sandboxProvider, {
  image: process.env.STAGEHAND_CODEMODE_IMAGE,
  environment: { STAGEHAND_BROWSER: "browserbase" },
});

try {
  // Start the Eve host with STAGEHAND_MCP_URL=stagehand.url and
  // STAGEHAND_MCP_TOKEN=stagehand.token.
} finally {
  await stagehand.close();
}
```

For Vercel Sandbox specifically, create a Node 24 Firecracker guest with port `3000`, map
`writeTextFile` to `sandbox.writeFiles`, map `spawn` to a detached `sandbox.runCommand`, map
`publicUrl` to `sandbox.domain`, and map `close` to `sandbox.stop`. Vercel's command handle exposes
stdout and stderr but not a writable stdin stream after launch, so the Eve host cannot drive the
stdio MCP directly across the SDK boundary. That is why both `supergateway` and the authentication
proxy run inside the guest. The adapter must also materialize the pinned Stagehand image contents
inside the guest—such as through a mirrored runtime image or an exact source build—and return the
resulting local Node command as `stdioCommand`; do not assume nested Docker is available.

`createStagehandSandboxGateway` polls the authenticated `/healthz` endpoint before returning. The
default startup deadline is two minutes, is configurable with `startupTimeoutMs`, and is capped
below the complete sandbox lifetime. This prevents Eve from racing a cold guest bootstrap or
public port publication without permitting an unbounded wait.

The host starts one authenticated proxy and one stateful `supergateway` process per sandbox.
`supergateway` starts one Stagehand stdio child for each MCP session. `supergateway` is a
non-first-party adapter. The bootstrap pins it to `3.4.3`, sets `--logLevel none`, protects the
public port with a bearer token, and closes the complete sandbox after the Eve run. Do not expose
`supergateway` directly: it does not add inbound authentication.

For production, bake the audited gateway and its exact dependency tree into the guest image. The
runtime `npm install` in `src/sandbox.ts` makes this provider-neutral example executable, but it
adds a network-time supply-chain dependency during sandbox startup.

`src/sandbox.ts` accepts only the documented Stagehand and Browserbase environment names. Avoid
putting long-lived credentials there because generated JavaScript can read them. Prefer a sandbox
credential broker and an egress allowlist where the browser provider's HTTP and WebSocket
transports support them. The local test helper inherits the host environment for developer
convenience; it is explicitly not the production boundary.

## Verification status

We verified the two critical pieces independently:

- A real Vercel Firecracker sandbox ran the Stagehand stdio MCP behind the authenticated gateway.
  An unauthenticated request returned `401`; an authenticated MCP client initialized, listed only
  `code_execute`, and the complete sandbox was destroyed afterward.
- Eve `0.29.4` passed both the deterministic and real-model flows below through the same gateway
  implementation on localhost.

The full composition is still partial. A fresh host Eve `0.29.4` run against the same public
sandbox first made an SSE request without a session (`400`), then initialized a stateful MCP
session (`200`), sent the initialized notification (`202`), and opened its authenticated session
SSE stream (`200`). It did not advance to `tools/list` or `tools/call` before the bounded 150-second
proof timed out. This exact-version run therefore does not establish an Eve-to-sandbox
`code_execute` loop. Treat the architecture as supported but keep the composed deployment behind
an integration test until that Streamable HTTP client interoperability gap is closed.

## Run the deterministic smoke

From the repository root:

```bash
pnpm install
pnpm exec turbo run build --filter @browserbasehq/stagehand-integrations
STAGEHAND_BROWSER=local \
  pnpm --filter @browserbasehq/stagehand-integrations-example-eve smoke
```

The smoke deliberately runs the gateway on localhost so public CI needs no sandbox credentials. It
is not a sandbox-isolation proof. It does exercise the actual Eve runtime, rejects an unauthorized
request, and then runs authenticated Streamable HTTP `connection_search` followed by one
`stagehand__code_execute` call against a real local browser.

## Run a real Eve agent

The real example uses Eve `0.29.4` and a direct Groq model. Set `GROQ_API_KEY`, then run:

```bash
GROQ_API_KEY=<provider-key> \
STAGEHAND_BROWSER=local \
  pnpm --filter @browserbasehq/stagehand-integrations-example-eve e2e
```

To use Browserbase, set `STAGEHAND_BROWSER=browserbase`, `BROWSERBASE_API_KEY`, and optionally
`BROWSERBASE_PROJECT_ID` in the sandbox process. The production architecture remains the sandboxed
one above; the local commands exist only to make framework behavior reproducible in CI.
