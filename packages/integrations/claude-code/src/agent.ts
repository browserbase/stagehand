import { runClaudeAgentSession } from "@browserbasehq/stagehand-integrations-claude-agent-sdk";
import {
  FACADE_AGENT_INSTRUCTIONS,
  FACADE_TOOLS,
} from "@browserbasehq/stagehand-integrations/facade";
import { buildAllowlistedEnv } from "@browserbasehq/stagehand-integrations/harness";
import { fileURLToPath } from "node:url";

export const STAGEHAND_TOOL_NAMES = FACADE_TOOLS.map((tool) => `mcp__stagehand__${tool.name}`);

const logger = {
  log: () => {},
  warn: () => {},
  error: () => {},
};

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const instruction = (args[0] === "--" ? args.slice(1) : args).join(" ").trim();
  if (!instruction) throw new Error('Usage: pnpm start "your instruction"');

  // Resolved here (not at module load) so a missing build surfaces through
  // handleFailure instead of an uncaught module error.
  const serverPath = fileURLToPath(
    import.meta.resolve("@browserbasehq/stagehand-integrations/facade/stdio-server"),
  );

  const result = await runClaudeAgentSession({
    prompt: instruction,
    model: process.env.CLAUDE_STAGEHAND_MODEL ?? "claude-sonnet-5",
    logger,
    session: {
      maxTurns: 20,
      systemPromptPreset: FACADE_AGENT_INSTRUCTIONS,
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
      canUseTool: async (toolName, input) =>
        toolName.startsWith("mcp__stagehand__")
          ? { behavior: "allow", updatedInput: input }
          : { behavior: "deny", message: "Only stagehand browser tools are permitted." },
    },
  });
  if (result.iterationError) throw result.iterationError;
  if (!result.resultMessage) {
    throw new Error("Agent stream ended without a result message.");
  }
  if (result.resultMessage.subtype !== "success") {
    throw new Error(`Agent did not finish: ${String(result.resultMessage.subtype)}`);
  }
  // oxlint-disable-next-line no-console -- CLI example prints the agent result.
  console.log(result.resultText);
}

if (import.meta.main) {
  main().catch(handleFailure);
}

function handleFailure(error: unknown): void {
  // oxlint-disable-next-line no-console -- CLI example reports failures to stderr.
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
