import { AgentAction } from "../../types/public/agent";
import { ActionMappingOptions } from "../../types/private/agent";
import { ToolResult } from "../../types/private/agent";



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
    case "extract":
      return mapExtractToolResult(toolResult, args, reasoning);
    default:
      return [createStandardAction(toolCallName, args, reasoning)];
  }
}

function mapActToolResult(
  toolResult: ToolResult,
  args: Record<string, unknown>,
  reasoning?: string,
): AgentAction[] {
  if (!toolResult || typeof toolResult !== "object") {
    return [createStandardAction("act", args, reasoning)];
  }

  // Extract playwright arguments if they exist
  const action: AgentAction = {
    type: "act",
    reasoning,
    taskCompleted: false,
    ...args,
  };

  if (toolResult.output?.playwrightArguments) {
    action.playwrightArguments = toolResult.output.playwrightArguments;
  }

  return [action];
}

function mapFillFormToolResult(
  toolResult: ToolResult,
  args: Record<string, unknown>,
  reasoning?: string,
): AgentAction[] {
  if (!toolResult || typeof toolResult !== "object") {
    return [createStandardAction("fillForm", args, reasoning)];
  }

  const observeResults = Array.isArray(toolResult.output?.playwrightArguments)
    ? toolResult.output.playwrightArguments
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

function mapExtractToolResult(
  toolResult: ToolResult,
  args: Record<string, unknown>,
  reasoning?: string,
): AgentAction[] {
  const action: AgentAction = {
    type: "extract",
    reasoning,
    taskCompleted: false,
    ...args,
  };

  if (toolResult?.output?.result !== undefined) {
    action.result = toolResult.output.result;
  }

  return [action];
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
