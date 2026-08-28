/** Removes a leading provider segment from a model identifier. */
export function stripModelProvider(modelId: string): string {
  return modelId.includes("/") ? modelId.slice(modelId.indexOf("/") + 1) : modelId;
}

export function hasModelProviderAuth(clientOptions: unknown): boolean {
  if (!clientOptions || typeof clientOptions !== "object") return false;
  const auth = (clientOptions as { auth?: unknown }).auth;
  return auth !== undefined && auth !== null;
}

export function getInheritableModelOptions<T extends object>(
  clientOptions: T | undefined,
): Partial<T> | undefined {
  if (!clientOptions) return undefined;
  const inheritableOptions = { ...(clientOptions as Record<string, unknown>) };
  delete inheritableOptions.apiKey;
  delete inheritableOptions.auth;
  return inheritableOptions as Partial<T>;
}

export function trimTrailingTextNode(path: string | undefined): string | undefined {
  return path?.replace(/\/text\(\)(\[\d+\])?$/iu, "");
}

export function toTitleCase(str: string): string {
  return str.replace(/\w\S*/g, (text) => text.charAt(0).toUpperCase() + text.substring(1));
}
