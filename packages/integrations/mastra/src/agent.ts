import { FACADE_AGENT_INSTRUCTIONS } from "@browserbasehq/stagehand-integrations/facade";
import type { HarnessLogger } from "@browserbasehq/stagehand-integrations/harness";
import { runMastraSession } from "@browserbasehq/stagehand-integrations-mastra";

import { facadeMcpServer } from "./facade.ts";

// oxlint-disable-next-line no-console -- CLI example surfaces adapter warnings and errors on stderr.
const stderr = (line: { message: string }) => console.error(line.message);
const logger: HarnessLogger = { log: () => {}, warn: stderr, error: stderr };

async function main() {
  const args = process.argv.slice(2);
  const instruction = (args[0] === "--" ? args.slice(1) : args).join(" ").trim();
  if (!instruction) {
    throw new Error('Usage: pnpm start "your instruction"');
  }

  // Bare model ids are routed to OpenAI; `provider/model` ids pick another provider.
  const result = await runMastraSession({
    prompt: instruction,
    model: process.env.MASTRA_STAGEHAND_MODEL ?? "gpt-5.6-luna",
    logger,
    session: {
      agentId: "stagehand-facade-agent",
      agentName: "Stagehand Facade Agent",
      instructions: FACADE_AGENT_INSTRUCTIONS,
      maxSteps: 20,
      mcpServers: { stagehand: facadeMcpServer() },
    },
  });

  // oxlint-disable-next-line no-console -- CLI example prints the agent result.
  if (result.finalText) console.log(result.finalText);
  if (result.status !== "completed") {
    throw new Error(
      `Mastra session ended with ${result.status}: ${result.stopReason ?? "unknown"}`,
    );
  }
}

main().catch((error: unknown) => {
  // oxlint-disable-next-line no-console -- CLI example reports failures to stderr.
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
