function stripProviderPrefix(modelId: string): string {
  const slashIndex = modelId.indexOf("/");
  return slashIndex === -1 ? modelId : modelId.slice(slashIndex + 1);
}

export function isReasoningModelWithoutTemperatureSupport(
  modelId: string,
): boolean {
  const normalizedModelId = stripProviderPrefix(modelId).toLowerCase();

  return /^(gpt-5(?:$|[.-])|o(?:1|3|4)(?:$|[.-]))/.test(normalizedModelId);
}

export function resolveTemperatureForModel(
  modelId: string,
  temperature?: number,
): number | undefined {
  const normalizedModelId = stripProviderPrefix(modelId).toLowerCase();

  if (normalizedModelId.includes("kimi")) {
    return 1;
  }

  if (normalizedModelId === "claude-opus-4-7") {
    return undefined;
  }

  if (isReasoningModelWithoutTemperatureSupport(modelId)) {
    return undefined;
  }

  return temperature;
}
