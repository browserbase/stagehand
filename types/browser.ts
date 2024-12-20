import { Browser, BrowserContext } from "@playwright/test";

export interface BrowserResult {
  env: "LOCAL" | "BROWSERBASE";
  browser?: Browser;
  context: BrowserContext;
  debugUrl?: string;
  sessionUrl?: string;
  contextPath?: string;
  sessionId?: string;
}
