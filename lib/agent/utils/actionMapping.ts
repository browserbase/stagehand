import {
  AgentAction,
  ActToolResult,
  FillFormResult,
  ToolExecutionResult,
} from "@/types/agent";

export interface ActionMappingOptions {
  toolCallName: string;
  toolResult: ToolExecutionResult | null;
  args: Record<string, unknown>;
  reasoning?: string;
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
      return [createStandardAction(toolCallName, args, reasoning)];
  }
}

function mapActToolResult(
  toolResult: ToolExecutionResult | null,
  args: Record<string, unknown>,
  reasoning?: string,
): AgentAction[] {
  if (!toolResult) {
    return [createStandardAction("act", args, reasoning)];
  }

  const result = toolResult.result as ActToolResult;
  const playwrightArguments = result?.playwrightArguments
    ? { playwrightArguments: result.playwrightArguments }
    : {};

  return [
    {
      type: "act",
      reasoning,
      taskCompleted: false,
      ...args,
      ...playwrightArguments,
    },
  ];
}

function mapFillFormToolResult(
  toolResult: ToolExecutionResult | null,
  args: Record<string, unknown>,
  reasoning?: string,
): AgentAction[] {
  if (!toolResult) {
    return [createStandardAction("fillForm", args, reasoning)];
  }

  const fillResult = toolResult.result as FillFormResult;
  const observeResults = Array.isArray(fillResult?.playwrightArguments)
    ? fillResult.playwrightArguments
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
      toolCallName === "close"
        ? // Our close tool uses `success` boolean in args
          (args?.success as boolean)
        : false,
    ...args,
  };
}
