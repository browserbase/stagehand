export const AISDK_PROVIDERS = [
  "openai",
  "anthropic",
  "google",
  "xai",
  "azure",
  "groq",
  "cerebras",
  "togetherai",
  "mistral",
  "deepseek",
  "perplexity",
  "ollama",
] as const;
export type AISDKProvider = (typeof AISDK_PROVIDERS)[number];

export type LegacyModel =
  | "gpt-4o"
  | "gpt-4o-mini"
  | "gpt-4o-2024-08-06"
  | "gpt-4o-2024-05-13"
  | "claude-3-5-sonnet-latest"
  | "claude-3-5-sonnet-20241022"
  | "claude-3-5-sonnet-20240620"
  | "claude-3-7-sonnet-20250219"
  | "claude-3-7-sonnet-latest"
  | "cerebras-llama-3.3-70b"
  | "cerebras-llama-3.1-8b"
  | "o1-mini"
  | "o1-preview"
  | "o3-mini"
  | "gpt-4.5-preview"
  | "groq-llama-3.3-70b-specdec"
  | "groq-llama-3.3-70b-versatile"
  | "gemini-1.5-flash"
  | "gemini-1.5-pro"
  | "gemini-1.5-flash-8b"
  | "gemini-2.0-flash-lite"
  | "gemini-2.0-flash"
  | "gemini-2.5-pro-preview-03-25"
  | "gemini-2.5-flash-preview-04-17";

export type LegacyProvider = "openai" | "anthropic" | "google";
