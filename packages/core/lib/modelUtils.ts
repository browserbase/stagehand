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

  // Parse the model string
  const { provider, modelName: parsedModelName } = splitModelName(modelString);

  // Check if it's a CUA model
  const isCua = AVAILABLE_CUA_MODELS.includes(modelString as AvailableCuaModel);

  return {
    provider,
    modelName: parsedModelName,
    clientOptions,
    isCua,
  };
}
