import type {
  BrowserbaseModelConfig,
  BrowserbaseUnlistedModelConfig,
  CustomModelConfig,
  KnownModelConfig,
  ModelConfig,
  UnlistedModelConfig,
} from "../../protocol/types.js";

export type DirectModelTarget = {
  type: "direct";
  modelName: string;
  apiKey: string;
  headers?: Record<string, string>;
};

export type BrowserbaseModelTarget = {
  type: "browserbase";
  modelName: string;
};

export type OpenAICompatibleModelTarget = {
  type: "openai-compatible";
  modelName: string;
  baseURL: string;
  apiKey?: string;
  headers?: Record<string, string>;
};

export type ModelTarget = DirectModelTarget | BrowserbaseModelTarget | OpenAICompatibleModelTarget;

type DirectModelConfig = KnownModelConfig | UnlistedModelConfig;
type BrowserbaseConfig = BrowserbaseModelConfig | BrowserbaseUnlistedModelConfig;

function isBrowserbaseModel(config: ModelConfig): config is BrowserbaseConfig {
  return config.modelName.startsWith("browserbase/");
}

function isOpenAICompatibleModel(config: ModelConfig): config is CustomModelConfig {
  return "baseURL" in config;
}

function isDirectModel(config: ModelConfig): config is DirectModelConfig {
  return "apiKey" in config && !isOpenAICompatibleModel(config);
}

/** Resolves the public model-name namespace into the server's execution target. */
export function resolveModelTarget(config: ModelConfig): ModelTarget {
  if (isOpenAICompatibleModel(config)) {
    return {
      type: "openai-compatible",
      modelName: config.modelName,
      baseURL: config.baseURL,
      apiKey: config.apiKey,
      headers: config.headers,
    };
  }

  if (isBrowserbaseModel(config)) {
    return {
      type: "browserbase",
      modelName: config.modelName.slice("browserbase/".length),
    };
  }

  if (isDirectModel(config)) {
    return {
      type: "direct",
      modelName: config.modelName,
      apiKey: config.apiKey,
      headers: config.headers,
    };
  }

  throw new Error("Model configuration did not resolve to a supported inference target");
}
