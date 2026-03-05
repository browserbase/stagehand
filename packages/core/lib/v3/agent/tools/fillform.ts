import { tool } from "ai";
import { z } from "zod";
import type { V3 } from "../../v3.js";
import type { Action } from "../../types/public/methods.js";
import type { AgentModelConfig, Variables } from "../../types/public/agent.js";
import { TimeoutError } from "../../types/public/sdkErrors.js";

export const fillFormTool = (
  v3: V3,
  executionModel?: string | AgentModelConfig,
  variables?: Variables,
  toolTimeout?: number,
) => {
  const hasVariables = variables && Object.keys(variables).length > 0;
  const valueDescription = hasVariables
    ? `Text to type into the target. Use %variableName% to substitute a variable value. Available: ${Object.keys(variables).join(", ")}`
    : "Text to type into the target";

  return tool({
    description: `📝 FORM FILL - MULTI-FIELD INPUT TOOL\nFor any form with 2+ inputs/textareas. Faster than individual typing.`,
    inputSchema: z.object({
      fields: z
        .array(
          z.object({
            action: z
              .string()
              .describe(
                'Description of typing action, e.g. "type foo into the email field"',
              ),
            value: z.string().describe(valueDescription),
          }),
        )
        .min(1, "Provide at least one field to fill"),
    }),
    execute: async ({ fields }) => {
      try {
        v3.logger({
          category: "agent",
          message: `Agent calling tool: fillForm`,
          level: 1,
          auxiliary: {
            arguments: {
              value: JSON.stringify(fields),
              type: "object",
            },
          },
        });
        const instruction = `Return observation results for the following actions: ${fields
          .map((f) => f.action)
          .join(", ")}`;

        const observeOptions = executionModel
          ? { model: executionModel, timeout: toolTimeout }
          : { timeout: toolTimeout };
        const observeResults = await v3.observe(instruction, observeOptions);

        const completed = [] as unknown[];
        const replayableActions: Action[] = [];
        for (const res of observeResults) {
          const actOptions = variables
            ? { variables, timeout: toolTimeout }
            : { timeout: toolTimeout };
          const actResult = await v3.act(res, actOptions);
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
        return {
          success: true,
          actions: completed,
          playwrightArguments: replayableActions,
        };
      } catch (error) {
        if (error instanceof TimeoutError) {
          const timeoutMessage = `TimeoutError while waiting for fillForm() to complete (it may continue executing in the background)`;
          v3.logger({
            category: "agent",
            message: timeoutMessage,
            level: 0,
          });
          return {
            success: false,
            error: `${timeoutMessage} — try filling fewer fields at once or use a different tool`,
          };
        }
        return {
          success: false,
          error: error?.message ?? String(error),
        };
      }
    },
  });
};
