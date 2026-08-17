import { Codex, type CodexOptions } from "@openai/codex-sdk";
import { fileURLToPath } from "node:url";

import { buildAllowlistedEnv } from "./env.ts";

const serverPath = fileURLToPath(
  import.meta.resolve("@browserbasehq/stagehand-integrations/facade/stdio-server"),
);

/**
 * codex-sdk has no in-process MCP mounting; MCP servers are supplied through
 * the config override (config.toml shape), the same mechanism the evals codex
 * harness uses.
 */
export function buildCodexConfig(): NonNullable<CodexOptions["config"]> {
  return {
    // Required for headless MCP calls on machines without a global
    // approvals_reviewer: without it, tool calls die with "user cancelled
    // MCP tool call" regardless of approvalPolicy.
    approvals_reviewer: "auto_review",
    mcp_servers: {
      stagehand: {
        command: process.execPath,
        args: [serverPath],
        env: buildAllowlistedEnv(),
        // Browser launches exceed the default MCP timeouts.
        startup_timeout_sec: 60,
        tool_timeout_sec: 300,
      },
    },
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const instruction = (args[0] === "--" ? args.slice(1) : args).join(" ").trim();
  if (!instruction) throw new Error('Usage: pnpm start "your instruction"');

  const codex = new Codex({
    ...(process.env.OPENAI_API_KEY ? { apiKey: process.env.OPENAI_API_KEY } : {}),
    // pnpm can skip the SDK's vendored-binary postinstall; point at a locally
    // installed codex when that happens (same escape hatch the evals harness
    // uses).
    ...(process.env.CODEX_PATH_OVERRIDE
      ? { codexPathOverride: process.env.CODEX_PATH_OVERRIDE }
      : {}),
    config: buildCodexConfig(),
  });
  const thread = codex.startThread({
    // Codex picks its own harness-tuned default model; override only via env.
    ...(process.env.CODEX_STAGEHAND_MODEL ? { model: process.env.CODEX_STAGEHAND_MODEL } : {}),
    // The browser work happens in the MCP server; the local sandbox can stay
    // read-only.
    sandboxMode: "read-only",
    // Headless policy chosen empirically: "on-failure" lets MCP tool calls
    // complete; "never" and "untrusted" auto-cancel them ("user cancelled
    // MCP tool call").
    approvalPolicy: "on-failure",
    skipGitRepoCheck: true,
  });

  const streamed = await thread.runStreamed(instruction);
  let finalResponse = "";
  for await (const event of streamed.events) {
    if (
      event.type === "item.completed" &&
      typeof event.item === "object" &&
      event.item !== null &&
      "type" in event.item &&
      event.item.type === "agent_message" &&
      "text" in event.item &&
      typeof event.item.text === "string"
    ) {
      finalResponse = event.item.text;
    }
  }
  // oxlint-disable-next-line no-console -- CLI example prints the agent result.
  console.log(finalResponse);
}

if (import.meta.main) {
  main().catch(handleFailure);
}

function handleFailure(error: unknown): void {
  // oxlint-disable-next-line no-console -- CLI example reports failures to stderr.
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
