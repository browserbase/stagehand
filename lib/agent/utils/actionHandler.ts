import { AgentAction } from "@/types/agent";
import { AgentToolResult, AgentToolCall } from "@/lib/agent/tools";

export interface ActionHandlerOptions {
  toolCallName: string;
  toolResult: AgentToolResult;
  args: AgentToolCall["args"];
  reasoning?: string;
}

export function mapToolResultToActions({
  toolCallName,
  toolResult,
  args,
  reasoning,
}: ActionHandlerOptions): AgentAction[] {
  if (toolResult) {
    if (toolResult.toolName === "act") {
      const result = toolResult.result;

      const playwrightArguments = result.playwrightArguments
        ? { playwrightArguments: result.playwrightArguments }
        : {};

      return [
        {
          type: "act",
          reasoning,
          taskCompleted: false,
          ...playwrightArguments,
        },
      ];
    }

    if (toolResult.toolName === "fillForm") {
      const result = toolResult.result;
      const observeResults = Array.isArray(result.playwrightArguments)
        ? result.playwrightArguments
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
  }

  return [
    {
      type: toolCallName,
      reasoning,
      taskCompleted:
        toolCallName === "close" && args && "success" in args
          ? args.success
          : false,
      ...args,
    },
  ];
}
