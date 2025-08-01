import { AgentType } from "@/types/agent";
import { LogLine } from "@/types/log";
import {
  UnsupportedModelError,
  UnsupportedModelProviderError,
} from "@/types/stagehandErrors";
import { ToolSet } from "ai";
import { Page } from "../../types/page";
import { Stagehand } from "../index";
import { AgentClient } from "./AgentClient";
import { AISDKAgent } from "./AISDKAgent";
import { AnthropicCUAClient } from "./AnthropicCUAClient";
import { OpenAICUAClient } from "./OpenAICUAClient";

// Map model names to their provider types
const modelToAgentProviderMap: Record<string, AgentType> = {
  "computer-use-preview": "openai",
  "computer-use-preview-2025-03-11": "openai",
  "claude-3-7-sonnet-latest": "anthropic",
  "claude-sonnet-4-20250514": "anthropic",
};

/**
 * Provider for agent clients
 * This class is responsible for creating the appropriate agent client
 * based on the provider type
 */
export class AgentProvider {
  private logger: (message: LogLine) => void;
  private stagehandInstance?: Stagehand;
  private page?: Page;

  /**
   * Create a new agent provider
   */
  constructor(
    logger: (message: LogLine) => void,
    stagehandInstance?: Stagehand,
    page?: Page,
  ) {
    this.logger = logger;
    this.stagehandInstance = stagehandInstance;
    this.page = page;
  }

  getClient(
    modelName: string,
    clientOptions?: Record<string, unknown>,
    userProvidedInstructions?: string,
    tools?: ToolSet,
    experimental?: boolean,
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
            experimental,
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

  getAgent(options: {
    modelName?: string;
    provider?: string;
    clientOptions?: Record<string, unknown>;
    userProvidedInstructions?: string;
    experimental?: boolean;
  }): AISDKAgent {
    if (options.provider === "aisdk") {
      if (!options.modelName) {
        throw new Error(
          'Stagehand Agent requires a model. Use format: { provider: "aisdk", model: "provider/model-id" }',
        );
      }
      const modelName = options.modelName;

      return new AISDKAgent({
        stagehand: this.stagehandInstance,
        page: this.page,
        modelName,
        apiKey: options.clientOptions?.apiKey as string,
        userProvidedInstructions: options.userProvidedInstructions,
      });
    }
  }
}
