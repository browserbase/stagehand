import { tool } from "ai";
import { z } from "zod/v3";
import type { V3 } from "@/lib/v3/v3";
import type { Action } from "@/lib/v3/types/stagehand";

export const createFillFormTool = (v3: V3, executionModel?: string) =>
  tool({
    description: `📝 FORM FILL - MULTI-FIELD INPUT TOOL\nFor any form with 2+ inputs/textareas. Faster than individual typing.`,
    parameters: z.object({
      fields: z
        .array(
          z.object({
            action: z
              .string()
              .describe(
                'Description of typing action, e.g. "type foo into the email field"',
              ),
            value: z.string().describe("Text to type into the target"),
          }),
        )
        .min(1, "Provide at least one field to fill"),
    }),
    execute: async ({ fields }) => {
      const instruction = `Return observation results for the following actions: ${fields
        .map((f) => f.action)
        .join(", ")}`;

      const observeResults = await v3.observe(instruction, {
        modelName: executionModel,
      });

      const completed = [] as unknown[];
      const replayableActions: Action[] = [];
      for (const res of observeResults) {
        const actResult = await v3.act(res);
        completed.push(actResult);
        if (Array.isArray(actResult.actions)) {
          replayableActions.push(...(actResult.actions as Action[]));
        }
      }
      v3.recordAgentReplayStep({
        type: "fillForm",
        fields,
        observeResults,
        actions: replayableActions,
      });
      return { success: true, actions: completed };
    },
  });
