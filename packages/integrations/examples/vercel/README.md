# Vercel AI SDK with sandboxed Stagehand code mode

This example runs the Stagehand code-mode MCP server over stdio **inside an E2B Firecracker
microVM**. The Vercel AI SDK stays outside the sandbox and connects through E2B's authenticated
Streamable HTTP gateway.

```text
Vercel AI SDK + model
  └─ authenticated Streamable HTTP
       └─ E2B Firecracker microVM
            └─ Stagehand MCP over stdio
                 └─ generated JavaScript + Browserbase browser
```

## Install and run

Set these variables in your host application. `STAGEHAND_REVISION` must be a complete commit hash
that contains the code-mode MCP server.

```bash
E2B_API_KEY=<e2b-api-key>
BROWSERBASE_API_KEY=<browserbase-api-key>
BROWSERBASE_PROJECT_ID=<browserbase-project-id>
ANTHROPIC_API_KEY=<anthropic-api-key>
STAGEHAND_REVISION=<40-character-git-commit>

pnpm --filter @browserbasehq/stagehand-integrations-example-vercel e2e
```

The host uses `E2B_API_KEY` to create the microVM and `ANTHROPIC_API_KEY` for
[`claude-opus-5`](https://platform.claude.com/docs/en/about-claude/models/whats-new-opus-5).
Only the two Browserbase credentials are passed into the sandbox by default. If generated code uses
Stagehand AI methods, pass one explicit Stagehand model name and key through
`StagehandSandboxOptions`; do not forward the host's complete environment.

## Use the binding

```ts
import { anthropic } from "@ai-sdk/anthropic";
import { generateText, stepCountIs } from "ai";
import { createStagehandMcpBinding } from "./src/agent.js";

const stagehand = await createStagehandMcpBinding({
  stagehandRevision: process.env.STAGEHAND_REVISION!,
  browserbaseApiKey: process.env.BROWSERBASE_API_KEY!,
  browserbaseProjectId: process.env.BROWSERBASE_PROJECT_ID!,
});

try {
  const result = await generateText({
    model: anthropic("claude-opus-5"),
    tools: stagehand.tools,
    stopWhen: stepCountIs(8),
    prompt: "Open example.com and return the page title.",
  });
  console.log(result.text);
} finally {
  await stagehand.close();
}
```

E2B's current gateway requires MCP protocol `2025-06-18`, so the binding pins that version. The
gateway prefixes custom GitHub tool names; the example remaps the discovered tool to the
provider-safe name `stagehand_code_execute` before giving it to the model.

`close()` closes the MCP client and kills the complete sandbox. Binding creation also cleans up both
resources if gateway readiness or tool discovery fails. Always apply an application deadline and
kill the microVM if generated code stops responding.

The `smoke` script is a deterministic, no-secrets CI contract test against a trusted local browser.
It is not the production security pattern. See the shared
[`SANDBOX.md`](../../codemode/SANDBOX.md) for image, credential, network, and lifecycle guidance.
