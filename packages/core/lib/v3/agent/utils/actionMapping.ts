import { AgentAction } from "../../types/public/agent";
import { ActionMappingOptions } from "../../types/private/agent";

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
      return [createStandardAction(toolCallName, args, reasoning)];
  }
}

function mapActToolResult(
  toolResult: unknown,
  args: Record<string, unknown>,
  reasoning?: string,
): AgentAction[] {
  if (!toolResult || typeof toolResult !== "object") {
    return [createStandardAction("act", args, reasoning)];
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
    return [createStandardAction("fillForm", args, reasoning)];
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
  args: Record<string, unknown>,
  reasoning?: string,
): AgentAction {
  return {
    type: toolCallName,
    reasoning,
    taskCompleted:
      toolCallName === "close" ? (args?.taskComplete as boolean) : false,
    ...args,
  };
}
