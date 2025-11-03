import { Action } from "../public/methods";

export interface ActionMappingOptions {
  toolCallName: string;
  toolResult: ToolResult;
  args: Record<string, unknown>;
  reasoning?: string;
}

export interface ToolResult {
  output?: {
    success?: boolean;
    result?: unknown;
    playwrightArguments?: Action[];
  };
}
