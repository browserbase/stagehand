import { ModelConfiguration } from "./v3/types/public/model";
import {
  AVAILABLE_CUA_MODELS,
  AvailableCuaModel,
} from "./v3/types/public/agent";

export function splitModelName(model: string): {
  provider: string;
  modelName: string;
} {
  const firstSlashIndex = model.indexOf("/");
  const provider = model.substring(0, firstSlashIndex);
  const modelName = model.substring(firstSlashIndex + 1);
  return { provider, modelName };
}

export function resolveModel(model: string | ModelConfiguration): {
  provider: string;
  modelName: string;
  clientOptions: Record<string, unknown>;
  isCua: boolean;
} {
  // Extract the model string and client options
  const modelString = typeof model === "string" ? model : model.modelName;
  const clientOptions =
    typeof model === "string"
      ? {}
      : (() => {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { modelName: _, ...rest } = model;
          return rest;
        })();

  // Check if provider is explicitly set in clientOptions
  const hasExplicitProvider = clientOptions.provider !== undefined;

  // If provider is explicitly set, don't split the model name - pass it through as-is
  let provider: string;
  let parsedModelName: string;

  if (hasExplicitProvider) {
    provider = clientOptions.provider as string;
    parsedModelName = modelString; // Keep the full model name
  } else {
    // Parse the model string normally
    const split = splitModelName(modelString);
    provider = split.provider;
    parsedModelName = split.modelName;
  }

  // Check if it's a CUA model
  const isCua =
    hasExplicitProvider ||
    AVAILABLE_CUA_MODELS.includes(modelString as AvailableCuaModel);

  return {
    provider,
    modelName: parsedModelName,
    clientOptions,
    isCua,
  };
}
