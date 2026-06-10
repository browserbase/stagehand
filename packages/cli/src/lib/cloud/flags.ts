import { Flags } from "@oclif/core";

export const apiCommonFlags = {
  "api-key": Flags.string({
    description: "Override the Browserbase API key.",
    helpValue: "<apiKey>",
  }),
  "base-url": Flags.string({
    description: "Override the Browserbase API base URL.",
    helpValue: "<baseUrl>",
  }),
};

export interface ParsedApiCommonFlags {
  "api-key"?: string;
  "base-url"?: string;
}

export function toApiOptions(flags: ParsedApiCommonFlags): {
  apiKey?: string;
  baseUrl?: string;
} {
  return {
    apiKey: flags["api-key"],
    baseUrl: flags["base-url"],
  };
}
