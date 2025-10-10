import { ToolSet } from "ai/dist";
import { AgentProviderType } from "../types/public/agent";
import { LogLine } from "../types/public/logs";
import {
  UnsupportedModelError,
  UnsupportedModelProviderError,
} from "../types/public/sdkErrors";
import { AgentClient } from "./AgentClient";
import { AnthropicCUAClient } from "./AnthropicCUAClient";
import { OpenAICUAClient } from "./OpenAICUAClient";

// Map model names to their provider types
const modelToAgentProviderMap: Record<string, AgentProviderType> = {
  "computer-use-preview": "openai",
  "computer-use-preview-2025-03-11": "openai",
  "claude-3-7-sonnet-latest": "anthropic",
  "claude-sonnet-4-20250514": "anthropic",
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
        default:
          throw new UnsupportedModelProviderError(
            ["openai", "anthropic"],
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

  static getAgentProvider(modelName: string): AgentProviderType {
    const normalized = modelName.includes("/")
      ? modelName.split("/")[1]
      : modelName;

    if (normalized in modelToAgentProviderMap) {
      return modelToAgentProviderMap[normalized];
    }

    throw new UnsupportedModelError(
      Object.keys(modelToAgentProviderMap),
      "Computer Use Agent",
    );
  }
}
