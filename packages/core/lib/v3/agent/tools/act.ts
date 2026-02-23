import { tool } from "ai";
import { z } from "zod";
import type { V3 } from "../../v3.js";
import type { Action } from "../../types/public/methods.js";
import type { AgentModelConfig, Variables } from "../../types/public/agent.js";

export const actTool = (
  v3: V3,
  executionModel?: string | AgentModelConfig,
  variables?: Variables,
) => {
  const hasVariables = variables && Object.keys(variables).length > 0;
  const actionDescription = hasVariables
    ? `Describe what to click or type, e.g. "click the Login button" or "type %variableName% into the input". Available variables: ${Object.keys(variables).join(", ")}`
    : 'Describe what to click or type, e.g. "click the Login button" or "type "John" into the first name input"';

  return tool({
    description:
      "Perform an action on the page (click, type). Provide a short, specific phrase that mentions the element type.",
    inputSchema: z.object({
      action: z.string().describe(actionDescription),
    }),
    execute: async ({ action }) => {
      try {
        v3.logger({
          category: "agent",
          message: `Agent calling tool: act`,
          level: 1,
          auxiliary: {
            arguments: {
              value: action,
              type: "string",
            },
          },
        });
        const options = executionModel
          ? { model: executionModel, variables }
          : { variables };
        const result = await v3.act(action, options);
        const actions = (result.actions as Action[] | undefined) ?? [];
        v3.recordAgentReplayStep({
          type: "act",
          instruction: action,
          actions,
          actionDescription: result.actionDescription,
          message: result.message,
        });
        // Only include playwrightArguments when actions exist
        // (undefined is not valid JSON and breaks AI SDK validation)
        const response: {
          success: boolean;
          action: string;
          playwrightArguments?: Action;
        } = {
          success: result.success ?? true,
          action: result?.actionDescription ?? action,
        };
        if (actions.length > 0) {
          response.playwrightArguments = actions[0];
        }
        return response;
      } catch (error) {
        return { success: false, error: error?.message ?? String(error) };
      }
    },
  });
};
