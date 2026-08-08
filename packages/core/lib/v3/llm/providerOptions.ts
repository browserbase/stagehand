export function openAIStoreProviderOptions(provider: string | undefined) {
  return provider === "openai.responses"
    ? { openai: { store: false as const } }
    : {};
}
