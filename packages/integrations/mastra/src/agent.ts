import { openai } from "@ai-sdk/openai";
import { FACADE_AGENT_INSTRUCTIONS } from "@browserbasehq/stagehand-integrations/facade";
import { Agent } from "@mastra/core/agent";

import { createFacadeMCPClient } from "./client.ts";

async function main() {
  const instruction = process.argv.slice(2).join(" ").trim();
  if (!instruction) {
    throw new Error('Usage: pnpm start -- "your instruction"');
  }

  const client = createFacadeMCPClient();

  try {
    const { toolsets, errors } = await client.listToolsetsWithErrors();
    if (Object.keys(errors).length > 0) {
      throw new Error(`Failed to discover Stagehand facade tools: ${JSON.stringify(errors)}`);
    }

    const tools = toolsets.stagehand;
    if (!tools) {
      throw new Error("Stagehand facade toolset was not discovered");
    }

    const agent = new Agent({
      id: "stagehand-facade-agent",
      name: "Stagehand Facade Agent",
      instructions: FACADE_AGENT_INSTRUCTIONS,
      model: openai(process.env.MASTRA_STAGEHAND_MODEL ?? "gpt-5-mini"),
      tools,
    });

    const result = await agent.generate(instruction, { maxSteps: 20 });
    // oxlint-disable-next-line no-console -- CLI example prints the agent result.
    console.log(result.text);
  } finally {
    await client.disconnect();
  }
}

main().catch((error: unknown) => {
  // oxlint-disable-next-line no-console -- CLI example reports failures to stderr.
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
