import { AgentAction } from "@/types/agent";
import { AgentToolResult } from "@/lib/agent/tools";

export interface ActionHandlerOptions {
  toolCallName: string;
  toolResult: AgentToolResult | null;
  args: Record<string, unknown>;
  reasoning?: string;
}

export function mapToolResultToActions({
  toolCallName,
  toolResult,
  args,
  reasoning,
}: ActionHandlerOptions): AgentAction[] {
  if (toolResult) {
    // Use the discriminated union - toolResult.toolName tells us the type
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
      const result = toolResult.result as {
        success: boolean;
        playwrightArguments: unknown[];
      };
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
        toolCallName === "close" ? (args?.taskComplete as boolean) : false,
      ...args,
    },
  ];
}
