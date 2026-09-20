import type { BrowserbaseRegion } from "@browserbasehq/stagehand-protocol/types";

const REGION_API_URLS: Record<BrowserbaseRegion, string> = {
  "us-west-2": "https://api.stagehand.browserbase.com",
  "us-east-1": "https://api.use1.stagehand.browserbase.com",
  "eu-central-1": "https://api.euc1.stagehand.browserbase.com",
  "ap-southeast-1": "https://api.apse1.stagehand.browserbase.com",
};

const DEFAULT_REGION: BrowserbaseRegion = "us-west-2";

/** Resolves the regional Stagehand API endpoint for a Browserbase session. */
export function apiUrlForRegion(region: BrowserbaseRegion | undefined, apiUrl?: string): string {
  const baseUrl = apiUrl ?? REGION_API_URLS[region ?? DEFAULT_REGION];
  return `${baseUrl.replace(/\/+$/, "")}/v1`;
}
