import { StagehandError } from "@/types/stagehandErrors";

/**
 * Parse a model name into provider and model ID parts
 * @param modelName - The model name to parse (e.g., "openai/gpt-4" or "gpt-4")
 * @returns Object with provider and modelId, or null if no slash found
 */
export function parseModelName(modelName: string): {
  provider: string;
  modelId: string;
} | null {
  if (!modelName.includes("/")) {
    return null;
  }

  const firstSlashIndex = modelName.indexOf("/");
  return {
    provider: modelName.substring(0, firstSlashIndex),
    modelId: modelName.substring(firstSlashIndex + 1),
  };
}

/**
 * Infer provider from model name and add prefix if needed
 * @param modelName - The model name to process
 * @returns The model name with provider prefix
 * @throws StagehandError if provider cannot be inferred
 */
export function ensureModelNameHasProvider(modelName: string): string {
  if (modelName.includes("/")) {
    return modelName;
  }

  if (
    modelName.includes("gpt") ||
    modelName.includes("o3") ||
    modelName.includes("o1")
  ) {
    return `openai/${modelName}`;
  } else if (modelName.includes("claude")) {
    return `anthropic/${modelName}`;
  } else {
    throw new StagehandError(
      `Cannot infer provider for model "${modelName}". Please specify the model in the format "provider/model-id" (e.g., "openai/gpt-4", "anthropic/claude-3-5-sonnet").`,
    );
  }
}

/**
 * Extract provider from a model name with format "provider/model-id"
 * @param modelName - The model name to extract provider from
 * @returns The provider name or null if no provider found
 */
export function extractProvider(modelName: string): string | null {
  const parsed = parseModelName(modelName);
  return parsed?.provider || null;
}
