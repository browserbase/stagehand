import { AgentType } from "@/types/agent";
import { LogLine } from "@/types/log";
import {
  UnsupportedModelError,
  UnsupportedModelProviderError,
} from "@/types/stagehandErrors";
import { ToolSet } from "ai/dist";
import { AgentClient } from "./AgentClient";
import { AnthropicCUAClient } from "./AnthropicCUAClient";
import { OpenAICUAClient } from "./OpenAICUAClient";
import { GoogleCUAClient } from "./GoogleCUAClient";

// Map model names to their provider types
export const modelToAgentProviderMap: Record<string, AgentType> = {
  "computer-use-preview": "openai",
  "computer-use-preview-2025-03-11": "openai",
  "claude-3-7-sonnet-latest": "anthropic",
  "claude-haiku-4-5-20251001": "anthropic",
  "claude-sonnet-4-20250514": "anthropic",
  "claude-sonnet-4-5-20250929": "anthropic",
  "gemini-2.5-computer-use-preview-10-2025": "google",
};

/**
 * Provider for agent clients
 * This class is responsible for creating the appropriate agent client
 * based on the provider type
 */
export class AgentProvider {
  private logger: (message: LogLine) => void;

  /**
   * Create a new agent provider
   */
  constructor(logger: (message: LogLine) => void) {
    this.logger = logger;
  }

  getClient(
    modelName: string,
    clientOptions?: Record<string, unknown>,
    userProvidedInstructions?: string,
    tools?: ToolSet,
  ): AgentClient {
    const type = AgentProvider.getAgentProvider(modelName);
    this.logger({
      category: "agent",
      message: `Getting agent client for type: ${type}, model: ${modelName}`,
      level: 2,
    });

    try {
      switch (type) {
        case "openai":
          return new OpenAICUAClient(
            type,
            modelName,
            userProvidedInstructions,
            clientOptions,
            tools,
          );
        case "anthropic":
          return new AnthropicCUAClient(
            type,
            modelName,
            userProvidedInstructions,
            clientOptions,
            tools,
          );
        case "google":
          return new GoogleCUAClient(
            type,
            modelName,
            userProvidedInstructions,
            clientOptions,
          );
        default:
          throw new UnsupportedModelProviderError(
            ["openai", "anthropic", "google"],
            "Computer Use Agent",
          );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger({
        category: "agent",
        message: `Error creating agent client: ${errorMessage}`,
        level: 0,
      });
      throw error;
    }
  }

  static getAgentProvider(modelName: string): AgentType {
    // First check the exact model name in the map
    if (modelName in modelToAgentProviderMap) {
      return modelToAgentProviderMap[modelName];
    }

    throw new UnsupportedModelError(
      Object.keys(modelToAgentProviderMap),
      "Computer Use Agent",
    );
  }
}
