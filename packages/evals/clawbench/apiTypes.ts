import type { ClawBenchModelConfig } from "./types.js";

export type ClawBenchProvider = "anthropic" | "google" | "openai";

export function providerForApiType(
  apiType: ClawBenchModelConfig["api_type"],
): ClawBenchProvider {
  switch (apiType) {
    case "anthropic-messages":
      return "anthropic";
    case "google-generative-ai":
      return "google";
    case "openai-completions":
    case "openai-responses":
      return "openai";
  }
}

export function toClawBenchStagehandModelName(
  config: ClawBenchModelConfig,
): string {
  return `${providerForApiType(config.api_type)}/${config.model}`;
}
