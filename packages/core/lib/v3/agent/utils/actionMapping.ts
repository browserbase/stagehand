import { AgentAction } from "../../types/public/agent.js";
import { ActionMappingOptions } from "../../types/private/agent.js";

/**
 * Keys to exclude from tool outputs when mapping to actions.
 * These are large data fields that shouldn't be included in the actions array.
 * Users can access this data through result.messages if needed.
 */
const EXCLUDED_OUTPUT_KEYS = ["screenshotBase64"] as const;

/**
 * Strips excluded keys (like screenshotBase64) from a tool output object.
 */
function stripExcludedKeys(
  output: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(output)) {
    if (
      !EXCLUDED_OUTPUT_KEYS.includes(
        key as (typeof EXCLUDED_OUTPUT_KEYS)[number],
      )
    ) {
      result[key] = value;
    }
  }
  return result;
}

export function mapToolResultToActions({
  toolCallName,
  toolResult,
  args,
  reasoning,
}: ActionMappingOptions): AgentAction[] {
  switch (toolCallName) {
    case "act":
      return mapActToolResult(toolResult, args, reasoning);
    case "fillForm":
      return mapFillFormToolResult(toolResult, args, reasoning);
    default:
      return [createStandardAction(toolCallName, toolResult, args, reasoning)];
  }
}

function mapActToolResult(
  toolResult: unknown,
  args: Record<string, unknown>,
  reasoning?: string,
): AgentAction[] {
  if (!toolResult || typeof toolResult !== "object") {
    return [createStandardAction("act", toolResult, args, reasoning)];
  }

  const result = toolResult as Record<string, unknown>;

  // AI SDK wraps the tool result in an output property
  const output = (result.output as Record<string, unknown>) || result;

  // Extract playwright arguments if they exist
  const action: AgentAction = {
    type: "act",
    reasoning,
    taskCompleted: false,
    ...args,
  };

  if (output.playwrightArguments) {
    action.playwrightArguments = output.playwrightArguments;
  }

  return [action];
}

function mapFillFormToolResult(
  toolResult: unknown,
  args: Record<string, unknown>,
  reasoning?: string,
): AgentAction[] {
  if (!toolResult || typeof toolResult !== "object") {
    return [createStandardAction("fillForm", toolResult, args, reasoning)];
  }

  const result = toolResult as Record<string, unknown>;

  // AI SDK wraps the tool result in an output property
  const output = (result.output as Record<string, unknown>) || result;

  const observeResults = Array.isArray(output?.playwrightArguments)
    ? output.playwrightArguments
    : [];

  const actions: AgentAction[] = [];

  actions.push({
    type: "fillForm",
    reasoning,
    taskCompleted: false,
    ...args,
  });

  for (const observeResult of observeResults) {
    actions.push({
      type: "act",
      reasoning: "acting from fillform tool",
      taskCompleted: false,
      playwrightArguments: observeResult,
    });
  }

  return actions;
}

function createStandardAction(
  toolCallName: string,
  toolResult: unknown,
  args: Record<string, unknown>,
  reasoning?: string,
): AgentAction {
  const action: AgentAction = {
    type: toolCallName,
    reasoning,
    taskCompleted:
      toolCallName === "done" ? (args?.taskComplete as boolean) : false,
    ...args,
  };

  // For screenshot tool, exclude base64 data and just indicate a screenshot was taken,
  // if somebody really wants the base64 data, they can access it through messages
  if (toolCallName === "screenshot") {
    action.result = "screenshotTaken";
    return action;
  }

  // Spread the output from the tool result if it exists
  // Exclude ariaTree tool result as it is very large and unnecessary
  if (toolCallName !== "ariaTree" && toolResult) {
    const result = toolResult as { output?: unknown };
    const output = result.output;

    if (output && typeof output === "object" && !Array.isArray(output)) {
      const cleanedOutput = stripExcludedKeys(
        output as Record<string, unknown>,
      );
      Object.assign(action, cleanedOutput);
    }
  }

  return action;
}
