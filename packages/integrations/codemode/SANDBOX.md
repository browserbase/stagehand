# Run Stagehand code mode inside a sandbox

Stagehand code mode evaluates model-generated JavaScript. Run the MCP server inside an ephemeral
microVM or equivalent sandbox when that JavaScript is not fully trusted.

The `ghcr.io/browserbase/stagehand-codemode` image is a reproducible package for the stdio server.
It is **not** the security boundary. A container shares its host kernel; the sandbox provider must
isolate the container or process from the agent application's filesystem, processes, credentials,
and network.

## Architecture

```text
Agent application
  └─ authenticated Streamable HTTP MCP client
       └─ sandbox provider gateway
            └─ Firecracker microVM (security boundary)
                 └─ Stagehand code-mode MCP (stdio)
                      └─ generated JavaScript + Stagehand browser
```

Keep stdio inside the sandbox. Expose only the provider's authenticated MCP endpoint to a hosted
agent framework. Give the sandbox only the browser credentials it needs, restrict network egress
where the provider supports it, and destroy the complete sandbox when the agent run finishes or
times out.

## Pull an immutable image

The image is built from this repository on Node.js 24 and runs as the non-root `node` user. It starts
`dist/codemode/stdio-server.mjs` by default.

```bash
docker pull ghcr.io/browserbase/stagehand-codemode@sha256:<digest>
```

GHCR publishes a `sha-<40-character-git-commit>` tag for every permitted publish event. A digest is
the strongest production pin. The workflow never publishes `latest`.

## E2B template

[E2B custom images](https://e2b.dev/docs/template/base-image) currently require a Debian derivative,
which this image uses. Consume the final published image instead of passing `Dockerfile.codemode` to
`fromDockerfile()` because E2B's Dockerfile parser does not support multi-stage Dockerfiles.

```ts
import { Template, defaultBuildLogger, waitForTimeout } from "e2b";

const image = "ghcr.io/browserbase/stagehand-codemode@sha256:<digest>";

const template = Template()
  .fromImage(image)
  // Override the image entrypoint while E2B snapshots the template. Start the
  // stdio server per agent run so it receives that run's short-lived secrets.
  .setStartCmd("sleep infinity", waitForTimeout(1_000));

await Template.build(template, "stagehand-codemode", {
  cpuCount: 2,
  memoryMB: 2_048,
  onBuildLogs: defaultBuildLogger(),
});
```

For hosted frameworks, use an MCP gateway inside the same E2B microVM. The current
[custom-server gateway](https://e2b.dev/docs/mcp/custom-servers) launches a GitHub checkout over
stdio, then gives the outside client an authenticated Streamable HTTP URL. Until that gateway can
pre-pull arbitrary GHCR servers, use its source-checkout configuration for the bridge and use this
image for providers that accept an OCI root image directly.

## Other sandbox providers

- [Modal `Image.from_registry()`](https://modal.com/docs/reference/modal.Image#from_registry) can
  consume the GHCR image. Publish and select `linux/amd64` because Modal requires that architecture.
- [Vercel Sandbox custom images](https://vercel.com/docs/sandbox) boot in a Firecracker microVM, but
  currently pull custom root images from Vercel Container Registry. Mirror the pinned GHCR digest to
  VCR, or run this image with Docker inside the microVM; do not run generated code in the agent host.

## Codex and Claude Code devboxes

Codex and Claude Code commonly run inside the devbox. In that layout the CLI agent and Stagehand
stdio server are sibling processes inside one sandbox, so no HTTP bridge is necessary:

```text
Firecracker microVM / devbox (security boundary)
  ├─ Codex or Claude Code
  └─ Stagehand code-mode MCP (stdio child process)
```

After installing the CLI in the sandbox image or an E2B template layer, register the extracted
entrypoint from inside the sandbox:

```bash
codex mcp add stagehand -- \
  node /opt/stagehand-codemode/dist/codemode/stdio-server.mjs

claude mcp add --transport stdio stagehand -- \
  node /opt/stagehand-codemode/dist/codemode/stdio-server.mjs
```

See the official [Codex MCP configuration](https://developers.openai.com/codex/mcp/) and
[Claude Code MCP configuration](https://code.claude.com/docs/en/mcp) references.
Inject only the required browser credentials into the short-lived devbox environment; never bake
them into the image or a checked-in MCP configuration. When the CLI exits it closes the child's
stdin, which triggers graceful Stagehand cleanup. The sandbox owner must still enforce a deadline,
kill the whole process tree if cleanup stalls, and destroy the microVM.

## Security checklist

- Pin the image by digest and verify its provenance attestation.
- Put the stdio process and generated JavaScript inside the sandbox boundary.
- Pass only `BROWSERBASE_API_KEY`, `BROWSERBASE_PROJECT_ID`, and an explicit Stagehand model key when
  required; do not forward the agent host's complete environment.
- Authenticate the external MCP endpoint and pin the MCP protocol version required by the gateway.
- Apply provider network policy. The sandbox boundary protects the host but does not prevent a
  malicious snippet from reading secrets inside the sandbox or using allowed network egress.
- Close the MCP client, terminate the server process tree, and destroy the sandbox in cleanup paths.
