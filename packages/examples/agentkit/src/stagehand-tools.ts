import { z } from "zod";
import { stringToZodSchema } from "./utils.js";
import { getStagehand } from "./utils.js";
import { createTool } from "@inngest/agent-kit";

export const navigate = createTool({
  name: "navigate",
  description: "Navigate to a given URL",
  parameters: z.object({
    url: z.string().describe("the URL to navigate to"),
  }),
  handler: async ({ url }, { step, network }) => {
    return await step?.run("navigate", async () => {
      const stagehand = await getStagehand(network?.state.kv.get("browserbaseSessionID")!);
      try {
        const page = stagehand.context.pages()[0];
        await page.goto(url);
        return `Navigated to ${url}.`;
      } catch (error) {
        return `Failed to navigate to ${url}: ${error}`;
      }
    });
  },
});

export const extract = createTool({
  name: "extract",
  description: "Extract data from the page",
  parameters: z.object({
    instruction: z.string().describe("Instructions for what data to extract from the page"),
    schema: z
      .string()
      .describe(
        "A string representing the properties and types of data to extract, for example: '{ name: string, age: number }'",
      ),
  }),
  handler: async ({ instruction, schema }, { step, network }) => {
    return await step?.run("extract", async () => {
      const stagehand = await getStagehand(network?.state.kv.get("browserbaseSessionID")!);
      const zodSchema = stringToZodSchema(schema);
      try {
        return await stagehand.extract(instruction, zodSchema);
      } catch (error) {
        return `Failed to extract data from the page: ${error}`;
      }
    });
  },
});

export const act = createTool({
  name: "act",
  description: "Perform an action on the page",
  parameters: z.object({
    action: z.string().describe("The action to perform (e.g. 'click the login button')"),
  }),
  handler: async ({ action }, { step, network }) => {
    return await step?.run("act", async () => {
      const stagehand = await getStagehand(network?.state.kv.get("browserbaseSessionID")!);
      try {
        return await stagehand.act(action);
      } catch (error) {
        return `Failed to perform action on the page: ${error}`;
      }
    });
  },
});

export const observe = createTool({
  name: "observe",
  description: "Observe the page",
  parameters: z.object({
    instruction: z.string().describe("Specific instruction for what to observe on the page"),
  }),
  handler: async ({ instruction }, { step, network }) => {
    return await step?.run("observe", async () => {
      const stagehand = await getStagehand(network?.state.kv.get("browserbaseSessionID")!);
      try {
        return await stagehand.observe(instruction);
      } catch (error) {
        return `Failed to observe the page: ${error}`;
      }
    });
  },
});
