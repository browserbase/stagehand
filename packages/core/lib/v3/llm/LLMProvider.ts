import {
  ExperimentalNotConfiguredError,
  UnsupportedAISDKModelProviderError,
  UnsupportedModelError,
  UnsupportedModelProviderError,
} from "../types/public/sdkErrors";
import { LogLine } from "../types/public/logs";
import {
  AvailableModel,
  ClientOptions,
  ModelProvider,
} from "../types/public/model";
import { AISdkClient } from "./aisdk";
import { AnthropicClient } from "./AnthropicClient";
import { CerebrasClient } from "./CerebrasClient";
import { GoogleClient } from "./GoogleClient";
import { GroqClient } from "./GroqClient";
import { LLMClient } from "./LLMClient";
import { OpenAIClient } from "./OpenAIClient";
import { openai, createOpenAI } from "@ai-sdk/openai";
import { vertex, createVertex } from "@ai-sdk/google-vertex";
import { anthropic, createAnthropic } from "@ai-sdk/anthropic";
import { google, createGoogleGenerativeAI } from "@ai-sdk/google";
import { xai, createXai } from "@ai-sdk/xai";
import { azure, createAzure } from "@ai-sdk/azure";
import { groq, createGroq } from "@ai-sdk/groq";
import { cerebras, createCerebras } from "@ai-sdk/cerebras";
import { togetherai, createTogetherAI } from "@ai-sdk/togetherai";
import { mistral, createMistral } from "@ai-sdk/mistral";
import { deepseek, createDeepSeek } from "@ai-sdk/deepseek";
import { perplexity, createPerplexity } from "@ai-sdk/perplexity";
import { ollama } from "ollama-ai-provider-v2";
import { AISDKProvider, AISDKCustomProvider } from "../types/public/model";

/**
 * Check if a model name indicates Google Computer Use capability
 */
function isGoogleCuaModel(modelName: string): boolean {
  return modelName.includes("computer-use");
}

/**
 * Creates a custom fetch wrapper for Google CUA models.
 *
 * This enables a hybrid approach:
 * 1. AI SDK tools are defined locally with execute functions
 * 2. We strip functionDeclarations from requests and inject computerUse
 * 3. Google returns function calls using its native CUA tools (click_at, etc.)
 * 4. AI SDK matches these to our locally registered tools and calls execute()
 *
 * Additionally, we transform function responses to include the URL field
 * that Google CUA requires.
 */
function createGoogleCuaFetch(
  environment: "ENVIRONMENT_BROWSER" | "ENVIRONMENT_DESKTOP" = "ENVIRONMENT_BROWSER",
): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.body && typeof init.body === "string") {
      try {
        const body = JSON.parse(init.body);

        // Replace functionDeclarations with computerUse
        // Our AI SDK tools are still registered locally for execution
        // but we let Google provide the tool definitions via computerUse
        body.tools = [{ computerUse: { environment } }];

        // Remove toolConfig since computerUse handles tool selection
        delete body.toolConfig;

        // Transform function responses to Google CUA format
        // AI SDK sends: functionResponse, then inlineData (screenshot), then text
        // Google CUA expects: functionResponse with parts: [{ inlineData }] inside it
        if (body.contents && Array.isArray(body.contents)) {
          for (const content of body.contents) {
            if (content.parts && Array.isArray(content.parts)) {
              const newParts: Record<string, unknown>[] = [];
              let lastFunctionResponse: Record<string, unknown> | null = null;

              for (const part of content.parts) {
                if (part.functionResponse) {
                  // If we had a previous function response without screenshot, push it
                  if (lastFunctionResponse) {
                    newParts.push(lastFunctionResponse);
                  }

                  // Extract URL from the response content
                  let url = "";
                  if (part.functionResponse.response?.content) {
                    try {
                      const parsed = JSON.parse(
                        part.functionResponse.response.content,
                      );
                      url = parsed.url || "";
                    } catch {
                      // Not JSON, ignore
                    }
                  }

                  // Build Google CUA format function response (without screenshot yet)
                  lastFunctionResponse = {
                    functionResponse: {
                      name: part.functionResponse.name,
                      response: { url },
                    },
                  };
                } else if (part.inlineData && lastFunctionResponse) {
                  // This is a screenshot - attach it to the previous function response
                  const fr = lastFunctionResponse.functionResponse as Record<string, unknown>;
                  fr.parts = [
                    {
                      inlineData: {
                        mimeType: part.inlineData.mimeType || "image/png",
                        data: part.inlineData.data,
                      },
                    },
                  ];
                  // Push the complete function response with screenshot
                  newParts.push(lastFunctionResponse);
                  lastFunctionResponse = null;
                } else if (part.text && part.text.includes("Tool executed successfully")) {
                  // Skip the AI SDK's auto-generated success message
                  continue;
                } else {
                  // Keep other parts as-is
                  newParts.push(part);
                }
              }

              // Push any remaining function response without screenshot
              if (lastFunctionResponse) {
                newParts.push(lastFunctionResponse);
              }

              content.parts = newParts;
            }
          }
        }

        init = {
          ...init,
          body: JSON.stringify(body),
        };
      } catch {
        // If JSON parsing fails, pass through unchanged
      }
    }

    return fetch(input, init);
  };
}

const AISDKProviders: Record<string, AISDKProvider> = {
  openai,
  anthropic,
  google,
  xai,
  azure,
  groq,
  cerebras,
  togetherai,
  mistral,
  deepseek,
  perplexity,
  ollama,
  vertex,
};
const AISDKProvidersWithAPIKey: Record<string, AISDKCustomProvider> = {
  openai: createOpenAI,
  anthropic: createAnthropic,
  google: createGoogleGenerativeAI,
  vertex: createVertex,
  xai: createXai,
  azure: createAzure,
  groq: createGroq,
  cerebras: createCerebras,
  togetherai: createTogetherAI,
  mistral: createMistral,
  deepseek: createDeepSeek,
  perplexity: createPerplexity,
};

const modelToProviderMap: { [key in AvailableModel]: ModelProvider } = {
  "gpt-4.1": "openai",
  "gpt-4.1-mini": "openai",
  "gpt-4.1-nano": "openai",
  "o4-mini": "openai",
  //prettier-ignore
  "o3": "openai",
  "o3-mini": "openai",
  //prettier-ignore
  "o1": "openai",
  "o1-mini": "openai",
  "gpt-4o": "openai",
  "gpt-4o-mini": "openai",
  "gpt-4o-2024-08-06": "openai",
  "gpt-4.5-preview": "openai",
  "o1-preview": "openai",
  "claude-3-5-sonnet-latest": "anthropic",
  "claude-3-5-sonnet-20240620": "anthropic",
  "claude-3-5-sonnet-20241022": "anthropic",
  "claude-3-7-sonnet-20250219": "anthropic",
  "claude-3-7-sonnet-latest": "anthropic",
  "cerebras-llama-3.3-70b": "cerebras",
  "cerebras-llama-3.1-8b": "cerebras",
  "groq-llama-3.3-70b-versatile": "groq",
  "groq-llama-3.3-70b-specdec": "groq",
  "moonshotai/kimi-k2-instruct": "groq",
  "gemini-1.5-flash": "google",
  "gemini-1.5-pro": "google",
  "gemini-1.5-flash-8b": "google",
  "gemini-2.0-flash-lite": "google",
  "gemini-2.0-flash": "google",
  "gemini-2.5-flash-preview-04-17": "google",
  "gemini-2.5-pro-preview-03-25": "google",
};

export function getAISDKLanguageModel(
  subProvider: string,
  subModelName: string,
  clientOptions?: ClientOptions,
) {
  // Special handling for Google CUA models
  // We inject computerUse config but keep our AI SDK tools registered locally for execution
  // This allows Google's native CUA while routing execution through our tool handlers
  if (subProvider === "google" && isGoogleCuaModel(subModelName)) {
    const cuaFetch = createGoogleCuaFetch("ENVIRONMENT_BROWSER");
    const provider = createGoogleGenerativeAI({
      ...clientOptions,
      fetch: cuaFetch,
    });
    return provider(subModelName);
  }

  if (clientOptions && Object.keys(clientOptions).length > 0) {
    const creator = AISDKProvidersWithAPIKey[subProvider];
    if (!creator) {
      throw new UnsupportedAISDKModelProviderError(
        subProvider,
        Object.keys(AISDKProvidersWithAPIKey),
      );
    }
    const provider = creator(clientOptions);
    // Get the specific model from the provider
    return provider(subModelName);
  } else {
    const provider = AISDKProviders[subProvider];
    if (!provider) {
      throw new UnsupportedAISDKModelProviderError(
        subProvider,
        Object.keys(AISDKProviders),
      );
    }
    return provider(subModelName);
  }
}

export class LLMProvider {
  private logger: (message: LogLine) => void;

  constructor(logger: (message: LogLine) => void) {
    this.logger = logger;
  }

  getClient(
    modelName: AvailableModel,
    clientOptions?: ClientOptions,
    options?: { experimental?: boolean; disableAPI?: boolean },
  ): LLMClient {
    if (modelName.includes("/")) {
      const firstSlashIndex = modelName.indexOf("/");
      const subProvider = modelName.substring(0, firstSlashIndex);
      const subModelName = modelName.substring(firstSlashIndex + 1);
      if (
        subProvider === "vertex" &&
        !options?.disableAPI &&
        !options?.experimental
      ) {
        throw new ExperimentalNotConfiguredError("Vertex provider");
      }

      const languageModel = getAISDKLanguageModel(
        subProvider,
        subModelName,
        clientOptions,
      );

      return new AISdkClient({
        model: languageModel,
        logger: this.logger,
      });
    }

    const provider = modelToProviderMap[modelName];
    if (!provider) {
      throw new UnsupportedModelError(Object.keys(modelToProviderMap));
    }
    const availableModel = modelName as AvailableModel;
    switch (provider) {
      case "openai":
        return new OpenAIClient({
          logger: this.logger,
          modelName: availableModel,
          clientOptions,
        });
      case "anthropic":
        return new AnthropicClient({
          logger: this.logger,
          modelName: availableModel,
          clientOptions,
        });
      case "cerebras":
        return new CerebrasClient({
          logger: this.logger,
          modelName: availableModel,
          clientOptions,
        });
      case "groq":
        return new GroqClient({
          logger: this.logger,
          modelName: availableModel,
          clientOptions,
        });
      case "google":
        return new GoogleClient({
          logger: this.logger,
          modelName: availableModel,
          clientOptions,
        });
      default:
        throw new UnsupportedModelProviderError([
          ...new Set(Object.values(modelToProviderMap)),
        ]);
    }
  }

  static getModelProvider(modelName: AvailableModel): ModelProvider {
    if (modelName.includes("/")) {
      const firstSlashIndex = modelName.indexOf("/");
      const subProvider = modelName.substring(0, firstSlashIndex);
      if (AISDKProviders[subProvider]) {
        return "aisdk";
      }
    }
    const provider = modelToProviderMap[modelName];
    return provider;
  }
}
