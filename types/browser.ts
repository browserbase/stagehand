import { Browser, BrowserContext } from "@playwright/test";

export interface BrowserResult {
  browser?: Browser;
  context: BrowserContext;
  debugUrl?: string;
  sessionUrl?: string;
  contextPath?: string;
  sessionId?: string;
}
