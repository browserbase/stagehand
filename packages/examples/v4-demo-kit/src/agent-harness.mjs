import { openai } from "@ai-sdk/openai";
import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod/v4";
import { createSession } from "./session.mjs";
import { createDemoTools } from "./tools.mjs";

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const task =
    process.argv.slice(2).join(" ").trim() ||
    "Open Hacker News, find the newest stories, and return the titles of the first three stories. Do not sign in or submit data.";

  if (!process.env.OPENAI_API_KEY?.trim()) {
    throw new Error("Set OPENAI_API_KEY for the agent-harness demo.");
  }

  const session = await createSession();
  const stagehandTools = createDemoTools(session);

  try {
    console.log("Task:", task);
    console.log("The agent will choose tools now.\n");

    const result = await generateText({
      model: openai(process.env.AGENT_MODEL || "gpt-5.4-mini"),
      stopWhen: stepCountIs(20),
      instructions: `You control one persistent browser with three tools.
- snapshot reads a compact page tree with element IDs.
- run accepts either JavaScript or actions that use IDs from the latest snapshot.
- screenshot saves an image when visual inspection is useful.

Choose the next tool from the current page state. Use run code for a multi-step exact workflow. Use
snapshot and ID actions when you must inspect an unknown page before you act. Take a new snapshot
after navigation. Do not open another browser. Do not submit a purchase, message, form, or other
external side effect unless the task clearly asks for it. Return a short final answer with evidence.`,
      prompt: task,
      tools: {
        run: tool({
          description: stagehandTools.definitions.find((item) => item.name === "run").description,
          inputSchema: z
            .object({
              code: z.string().min(1).optional(),
              actions: z
                .array(
                  z.object({
                    op: z.enum(["click", "hover", "fill", "type", "press", "select"]),
                    id: z.string().min(1),
                    value: z.string().optional(),
                  }),
                )
                .min(1)
                .optional(),
            })
            .refine((input) => Boolean(input.code) !== Boolean(input.actions), {
              message: "Give exactly one of code or actions.",
            }),
          execute: async (input) => executeAndReport("run", input),
        }),
        snapshot: tool({
          description: stagehandTools.definitions.find((item) => item.name === "snapshot")
            .description,
          inputSchema: z.object({}),
          execute: async (input) => executeAndReport("snapshot", input),
        }),
        screenshot: tool({
          description: stagehandTools.definitions.find((item) => item.name === "screenshot")
            .description,
          inputSchema: z.object({ fullPage: z.boolean().optional() }),
          execute: async (input) => executeAndReport("screenshot", input),
        }),
      },
    });

    console.log("\nAgent answer:\n", result.text);
  } finally {
    await session.close();
  }

  async function executeAndReport(name, input) {
    console.log(`Agent chose ${name}:`, JSON.stringify(input));
    const output = await stagehandTools.call({ name, input });
    const preview = typeof output === "string" ? output.slice(0, 800) : output;
    console.log(`${name} result:`, preview, "\n");
    return output;
  }
}
