import { openai } from "@ai-sdk/openai";
import { FACADE_AGENT_INSTRUCTIONS } from "@browserbasehq/stagehand-integrations/facade";
import { generateText, stepCountIs, type ToolSet } from "ai";

import { createFacadeMCPClient } from "./client.ts";

async function main() {
  const args = process.argv.slice(2);
  const instruction = (args[0] === "--" ? args.slice(1) : args).join(" ").trim();
  if (!instruction) {
    throw new Error('Usage: pnpm start -- "your instruction"');
  }

  const client = await createFacadeMCPClient();

  try {
    const result = await generateText({
      model: openai(process.env.AI_SDK_STAGEHAND_MODEL ?? "gpt-5.6-luna"),
      // `ai` and `@ai-sdk/mcp` pin different exact @ai-sdk/provider-utils
      // versions, so their structurally identical schema types are nominally
      // distinct (unique-symbol brand). The cast bridges that; runtime is fine.
      tools: (await client.tools()) as ToolSet,
      stopWhen: stepCountIs(20),
      instructions: FACADE_AGENT_INSTRUCTIONS,
      prompt: instruction,
    });

    // oxlint-disable-next-line no-console -- CLI example prints the agent result.
    console.log(result.text);
  } finally {
    await client.close();
  }
}

main().catch((error: unknown) => {
  // oxlint-disable-next-line no-console -- CLI example reports failures to stderr.
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
