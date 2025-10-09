import { Page as PatchrightPage } from "patchright-core";
import { Page as PlaywrightPage } from "playwright-core";
import { Page as PuppeteerPage } from "puppeteer-core";
import { z, ZodTypeAny } from "zod/v3";
import { Page } from "../understudy/page";
import { ModelConfiguration } from "./model";

export interface ActOptions {
  model?: ModelConfiguration;
  variables?: Record<string, string>;
  domSettleTimeoutMs?: number;
  timeoutMs?: number;
  timeout?: number;
  iframes?: boolean;
  frameId?: string;
  page?: PlaywrightPage | PuppeteerPage | PatchrightPage | Page;
}

export interface ActResult {
  success: boolean;
  message: string;
  actionDescription: string;
  actions: Action[];
}

export type ExtractResult<T extends z.AnyZodObject> = z.infer<T>;

export interface ObserveOptions {
  instruction?: string;
  model?: ModelConfiguration;
  domSettleTimeoutMs?: number;
  returnAction?: boolean;
  selector?: string;
  /**
   * @deprecated The `onlyVisible` parameter has no effect in this version of Stagehand and will be removed in later versions.
   */
  onlyVisible?: boolean;
  drawOverlay?: boolean;
  iframes?: boolean;
  frameId?: string;
}

export interface Action {
  selector: string;
  description: string;
  backendNodeId?: number;
  method?: string;
  arguments?: string[];
}

export interface HistoryEntry {
  method: "act" | "extract" | "observe" | "navigate";
  parameters: unknown;
  result: unknown;
  timestamp: string;
}

export interface ActHandlerParams {
  instruction: string;
  model?: ModelConfiguration;
  variables?: Record<string, string>;
  timeout?: number;
  page: Page;
}

export interface ExtractOptions<T extends z.AnyZodObject> {
  instruction?: string;
  schema?: T;
  model?: ModelConfiguration;
  domSettleTimeoutMs?: number;
  /**
   * @deprecated The `useTextExtract` parameter has no effect in this version of Stagehand and will be removed in later versions.
   */
  useTextExtract?: boolean;
  selector?: string;
  iframes?: boolean;
  frameId?: string;
  timeout?: number;
  page?: PlaywrightPage | PuppeteerPage | PatchrightPage | Page;
}

export interface ExtractHandlerParams<T extends ZodTypeAny> {
  instruction?: string;
  schema?: T;
  model?: ModelConfiguration;
  timeout?: number;
  selector?: string;
  page: Page;
}

export const defaultExtractSchema = z.object({
  extraction: z.string(),
});

export const pageTextSchema = z.object({
  pageText: z.string(),
});

export interface ObserveOptions {
  model?: ModelConfiguration;
  timeout?: number;
  selector?: string;
  page?: PlaywrightPage | PuppeteerPage | PatchrightPage | Page;
}

export interface ObserveHandlerParams {
  instruction?: string;
  model?: ModelConfiguration;
  timeout?: number;
  selector?: string;
  page: Page;
}

export enum V3FunctionName {
  ACT = "ACT",
  EXTRACT = "EXTRACT",
  OBSERVE = "OBSERVE",
  AGENT = "AGENT",
}

// We can use this enum to list the actions supported in performPlaywrightMethod
export enum SupportedPlaywrightAction {
  CLICK = "click",
  FILL = "fill",
  TYPE = "type",
  PRESS = "press",
  SCROLL = "scrollTo",
  NEXT_CHUNK = "nextChunk",
  PREV_CHUNK = "prevChunk",
  SELECT_OPTION_FROM_DROPDOWN = "selectOptionFromDropdown",
}

export interface HistoryEntry {
  method: "act" | "extract" | "observe" | "navigate";
  parameters: unknown;
  result: unknown;
  timestamp: string;
}
