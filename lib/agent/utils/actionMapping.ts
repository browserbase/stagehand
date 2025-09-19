import {
  AgentAction,
  ActToolResult,
  FillFormResult,
  ActRelatedToolResult,
  ToolExecutionResult,
} from "@/types/agent";

// Type guards for better type safety
function isActRelatedToolResult(
  result: unknown,
): result is ActRelatedToolResult {
  return isActToolResult(result) || isFillFormResult(result);
}

function isActToolResult(result: unknown): result is ActToolResult {
  return typeof result === "object" && result !== null && "success" in result;
}

function isFillFormResult(result: unknown): result is FillFormResult {
  return (
    typeof result === "object" &&
    result !== null &&
    "success" in result &&
    "playwrightArguments" in result
  );
}

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
  if (toolResult && isActRelatedToolResult(toolResult.result)) {
    switch (toolCallName) {
      case "act":
        return mapActToolResult(toolResult, args, reasoning);
      case "fillForm":
        return mapFillFormToolResult(toolResult, args, reasoning);
    }
  }

  return [createStandardAction(toolCallName, args, reasoning)];
}

function mapActToolResult(
  toolResult: ToolExecutionResult | null,
  args: Record<string, unknown>,
  reasoning?: string,
): AgentAction[] {
  if (!toolResult || !isActToolResult(toolResult.result)) {
    return [createStandardAction("act", args, reasoning)];
  }

  const result = toolResult.result;
  const playwrightArguments = result.playwrightArguments
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
  if (!toolResult || !isFillFormResult(toolResult.result)) {
    return [createStandardAction("fillForm", args, reasoning)];
  }

  const fillResult = toolResult.result;
  const observeResults = Array.isArray(fillResult.playwrightArguments)
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
      toolCallName === "close" ? (args?.taskComplete as boolean) : false,
    ...args,
  };
}
