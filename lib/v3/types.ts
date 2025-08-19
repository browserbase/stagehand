import { LaunchedChrome } from "chrome-launcher";
import Browserbase from "@browserbasehq/sdk";
import { Page } from "./understudy/page";

export type V3Env = "LOCAL" | "BROWSERBASE";

/** Constructor options for V3 */
export interface V3Options {
  env: V3Env;

  // Browserbase (required when env = "BROWSERBASE")
  apiKey?: string;
  projectId?: string;

  // Local Chromium (optional)
  chromePath?: string;
  chromeFlags?: string[];
  headless?: boolean;
  userDataDir?: string;

  /** How long to wait for a CDP endpoint, in ms (default 15000) */
  connectTimeoutMs?: number;
}

/** Narrow shape we rely on from Browserbase session creation */
export interface BrowserbaseSession {
  id: string;
  connectUrl: string;
}

/** Narrow shape we rely on from /json/version */
export interface JsonVersionResponse {
  webSocketDebuggerUrl: string;
}

export type InitState =
  | { kind: "UNINITIALIZED" }
  | { kind: "LOCAL"; chrome: LaunchedChrome; ws: string }
  | { kind: "BROWSERBASE"; bb: Browserbase; sessionId: string; ws: string };

export type PlaywrightPage = import("playwright-core").Page;
export type PuppeteerPage = import("puppeteer-core").Page;

export type ActParams = {
  instruction: string;
  page?: PlaywrightPage | PuppeteerPage;
};

export interface ActHandlerParams {
  instruction: string;
  page: Page;
}

export type ExtractParams = {
  instruction: string;
  page?: PlaywrightPage | PuppeteerPage;
};

export interface ExtractHandlerParams {
  instruction: string;
  page: Page;
}

export type ObserveParams = {
  instruction: string;
  page?: PlaywrightPage | PuppeteerPage;
};

export interface ObserveHandlerParams {
  instruction: string;
  page: Page;
}
