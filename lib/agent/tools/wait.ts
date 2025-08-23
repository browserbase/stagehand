import { tool } from "ai";
import { z } from "zod";

export const createWaitTool = () =>
  tool({
    description: "Wait for a specified time",
    parameters: z.object({
      reasoning: z.string().describe("Why you need to wait"),
      parameters: z.string().describe("Time to wait in milliseconds"),
    }),
    execute: async ({ parameters }) => {
      const ms = parseInt(parameters);
      await new Promise((resolve) => setTimeout(resolve, ms));
      return { success: true, waited: ms };
    },
  });
