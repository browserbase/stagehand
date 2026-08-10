import { Page } from "../../understudy/page.js";
import { Page as PlaywrightPage } from "playwright-core";
import { Page as PatchrightPage } from "patchright-core";
import { Page as PuppeteerPage } from "puppeteer-core";

export type { PlaywrightPage, PatchrightPage, PuppeteerPage, Page };
export type AnyPage = PlaywrightPage | PuppeteerPage | PatchrightPage | Page;

export { ConsoleMessage } from "../../understudy/consoleMessage.js";
export type { ConsoleListener } from "../../understudy/consoleMessage.js";

export type LoadState = "load" | "domcontentloaded" | "networkidle";
export { Response } from "../../understudy/response.js";

export type SnapshotResult = {
  formattedTree: string;
  xpathMap: Record<string, string>;
  urlMap: Record<string, string>;
};

export type PageSnapshotOptions = {
  includeIframes?: boolean;
};

export type WebMCPTool = {
  name: string;
  description?: string;
  inputSchema?: string | Record<string, unknown>;
  annotations?: Record<string, unknown>;
  frameId: string;
};

export type WebMCPToolInvocationStatus = "Completed" | "Canceled" | "Error";

export type WebMCPToolResult = {
  invocationId: string;
  status: WebMCPToolInvocationStatus;
  output?: unknown;
  errorText?: string;
  exception?: unknown;
};

export type WebMCPToolInvocation = {
  invocationId: string;
  toolName: string;
  frameId: string;
  result: Promise<WebMCPToolResult>;
  cancel: () => Promise<void>;
};

export type WebMCPListToolsOptions = {
  timeoutMs?: number;
};

export type WebMCPToolInvocationOptions = {
  frameId?: string;
  timeoutMs?: number;
};
