import { Browser, BrowserContext } from "./page";

export interface BrowserResult {
  env: "LOCAL" | "BROWSERBASE" | "BROWSERSERVER";
  browser?: Browser;
  context?: BrowserContext;
  debugUrl?: string;
  sessionUrl?: string;
  contextPath?: string;
  sessionId?: string;
  browserServer?: unknown;
}
