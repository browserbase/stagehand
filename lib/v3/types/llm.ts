import { LanguageModel } from "ai";

export interface LLMTool {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export type AISDKProvider = (modelName: string) => LanguageModel;
// Represents a function that takes options (like apiKey) and returns an AISDKProvider
export type AISDKCustomProvider = (options: {
  apiKey: string;
}) => AISDKProvider;
