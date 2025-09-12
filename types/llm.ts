import { LanguageModel } from "ai";
import { ClientOptions } from "./model";

export interface LLMTool {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export type AISDKProvider = (modelName: string) => LanguageModel;
// Represents a function that takes options (like apiKey) and returns an AISDKProvider
export type AISDKCustomProvider = (options: ClientOptions) => AISDKProvider;
