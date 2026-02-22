import { ToolSet } from "ai/dist";
import { AgentProviderType } from "../types/public/agent.js";
import { LogLine } from "../types/public/logs.js";
import { ClientOptions } from "../types/public/model.js";
import {
  UnsupportedModelError,
  UnsupportedModelProviderError,
} from "../types/public/sdkErrors.js";
import { AgentClient } from "./AgentClient.js";
import { AnthropicCUAClient } from "./AnthropicCUAClient.js";
import { OpenAICUAClient } from "./OpenAICUAClient.js";
import { GoogleCUAClient } from "./GoogleCUAClient.js";
import { MicrosoftCUAClient } from "./MicrosoftCUAClient.js";

// Map model names to their provider types
export const modelToAgentProviderMap: Record<string, AgentProviderType> = {
  "computer-use-preview": "openai",
  "computer-use-preview-2025-03-11": "openai",
  "claude-3-7-sonnet-latest": "anthropic",
  "claude-sonnet-4-20250514": "anthropic",
  "claude-sonnet-4-5-20250929": "anthropic",
  "claude-opus-4-5-20251101": "anthropic",
  "claude-opus-4-6": "anthropic",
  "claude-sonnet-4-6": "anthropic",
  "claude-haiku-4-5-20251001": "anthropic",
  "gemini-2.5-computer-use-preview-10-2025": "google",
  "gemini-3-flash-preview": "google",
  "gemini-3-pro-preview": "google",
  "fara-7b": "microsoft",
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
    clientOptions?: ClientOptions,
    userProvidedInstructions?: string,
    tools?: ToolSet,
  ): AgentClient {
    // Check if provider is explicitly set in clientOptions
    const explicitProvider = clientOptions?.provider as
      | AgentProviderType
      | undefined;
    const type = explicitProvider || AgentProvider.getAgentProvider(modelName);

    this.logger({
      category: "agent",
      message: `Getting agent client for type: ${type}, model: ${modelName}${explicitProvider ? " (explicit provider)" : ""}`,
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
            tools,
          );
        case "microsoft":
          return new MicrosoftCUAClient(
            type,
            modelName,
            userProvidedInstructions,
            clientOptions,
          );
        default:
          throw new UnsupportedModelProviderError(
            ["openai", "anthropic", "google", "microsoft"],
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
