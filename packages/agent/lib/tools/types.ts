import type { ToolName } from "../protocol.js";

export type ToolSpec<TInput = any, TOutput = any> = {
  name: ToolName;
  description: string;
  inputSchema: {
    parse(input: unknown): TInput;
  };
  outputSchema: {
    parse(input: unknown): TOutput;
  };
  execute(
    input: TInput,
    context: AgentToolContext,
  ): Promise<TOutput> | TOutput;
};

export type AgentToolContext = {
  workspace: string;
};

export type ToolMap = Record<ToolName, ToolSpec>;
