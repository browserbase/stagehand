import { tool } from "ai";
import { z } from "zod";
import type { V3 } from "../../v3.js";
import type { Action } from "../../types/public/methods.js";
import type { AgentModelConfig, Variables } from "../../types/public/agent.js";
import { TimeoutError } from "../../types/public/sdkErrors.js";
import { substituteVariables } from "../utils/variables.js";

export const fillFormTool = (
  v3: V3,
  executionModel?: string | AgentModelConfig,
  variables?: Variables,
  toolTimeout?: number,
) => {
  const hasVariables = variables && Object.keys(variables).length > 0;
  const valueDescription = hasVariables
    ? `The exact text to type into the field. Use %variableName% to substitute a variable value. Available: ${Object.keys(variables).join(", ")}`
    : "The exact text to type into the field";
  const actionDescription = hasVariables
    ? `Describe which field to target, e.g. "type into the email input", "type into the password field". Use %variableName% to substitute a variable value. Available: ${Object.keys(variables).join(", ")}. Example: "type %email% into the email input"`
    : 'Describe which field to target, e.g. "type into the email input", "type into the first name input"';

  return tool({
    description:
      'FORM FILL - MULTI-FIELD INPUT TOOL\nFill 2+ form inputs/textareas at once. Each field requires an action describing the target element and a value with the text to type.',
    inputSchema: z.object({
      fields: z
        .array(
          z.object({
            action: z.string().describe(actionDescription),
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

        // Override observe results with the actual values provided by the agent.
        // The LLM used by observe() may hallucinate placeholder values instead of
        // using the intended text, so we inject the real values before calling act().
        for (let i = 0; i < observeResults.length && i < fields.length; i++) {
          const res = observeResults[i];
          if (res.method === "fill" && res.arguments && res.arguments.length > 0) {
            const actualValue = substituteVariables(fields[i].value, variables);
            res.arguments[0] = actualValue;
          }
        }

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
          throw error;
        }
        return {
          success: false,
          error: error?.message ?? String(error),
        };
      }
    },
  });
};
