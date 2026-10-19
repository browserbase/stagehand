import type { BrowserbaseRegion } from "@browserbasehq/stagehand-protocol/types";
import type { StagehandWorkerInitMetadata } from "./browser/factories.js";
import type { ResolvedStagehandClientCreateConfig } from "./clientSchemas.js";

const REGION_API_URLS: Record<BrowserbaseRegion, string> = {
  "us-west-2": "https://api.stagehand.browserbase.com",
  "us-east-1": "https://api.use1.stagehand.browserbase.com",
  "eu-central-1": "https://api.euc1.stagehand.browserbase.com",
  "ap-southeast-1": "https://api.apse1.stagehand.browserbase.com",
};

export type BrowserbaseConnection = Readonly<{
  apiKey: string;
  apiUrl: string;
  sessionId: string;
}>;

/** Resolves Gateway/cache settings from validated options and claimed-browser metadata. */
export function resolveBrowserbaseConnection(
  createConfig: Pick<ResolvedStagehandClientCreateConfig, "apiKey" | "apiUrl">,
  workerInitMetadata: StagehandWorkerInitMetadata,
): BrowserbaseConnection | undefined {
  const { apiKey, browser } = { apiKey: createConfig.apiKey, ...workerInitMetadata };
  if (!apiKey || !browser?.sessionId) return undefined;

  const baseUrl = createConfig.apiUrl ?? REGION_API_URLS[browser.region ?? "us-west-2"];
  return Object.freeze({
    apiKey,
    apiUrl: `${baseUrl.replace(/\/+$/, "")}/v1`,
    sessionId: browser.sessionId,
  });
}
