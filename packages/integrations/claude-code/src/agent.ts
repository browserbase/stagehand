import { query } from "@anthropic-ai/claude-agent-sdk";
import {
  FACADE_AGENT_INSTRUCTIONS,
  FACADE_TOOLS,
} from "@browserbasehq/stagehand-integrations/facade";
import { fileURLToPath } from "node:url";

import { buildAllowlistedEnv } from "./env.ts";

export const STAGEHAND_TOOL_NAMES = FACADE_TOOLS.map((tool) => `mcp__stagehand__${tool.name}`);

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const instruction = (args[0] === "--" ? args.slice(1) : args).join(" ").trim();
  if (!instruction) throw new Error('Usage: pnpm start "your instruction"');

  // Resolved here (not at module load) so a missing build surfaces through
  // handleFailure instead of an uncaught module error.
  const serverPath = fileURLToPath(
    import.meta.resolve("@browserbasehq/stagehand-integrations/facade/stdio-server"),
  );

  const result = query({
    prompt: instruction,
    options: {
      model: process.env.CLAUDE_STAGEHAND_MODEL ?? "claude-sonnet-5",
      maxTurns: 20,
      systemPrompt: FACADE_AGENT_INSTRUCTIONS,
      mcpServers: {
        stagehand: {
          command: process.execPath,
          args: [serverPath],
          env: buildAllowlistedEnv(),
        },
      },
      allowedTools: STAGEHAND_TOOL_NAMES,
      // Headless runs hang on any unanswered permission prompt; allow exactly
      // the stagehand tools and deny everything else.
      canUseTool: async (toolName) =>
        toolName.startsWith("mcp__stagehand__")
          ? { behavior: "allow", updatedInput: undefined }
          : { behavior: "deny", message: "Only stagehand browser tools are permitted." },
    },
  });

  for await (const message of result) {
    if (message.type === "result") {
      if (message.subtype === "success") {
        // oxlint-disable-next-line no-console -- CLI example prints the agent result.
        console.log(message.result);
        return;
      }
      throw new Error(`Agent did not finish: ${message.subtype}`);
    }
  }
  throw new Error("Agent stream ended without a result message.");
}

if (import.meta.main) {
  main().catch(handleFailure);
}

function handleFailure(error: unknown): void {
  // oxlint-disable-next-line no-console -- CLI example reports failures to stderr.
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
