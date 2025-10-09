import { Page as PatchrightPage } from "patchright-core";
import { Page as PlaywrightPage } from "playwright-core";
import { Page as PuppeteerPage } from "puppeteer-core";
import { z, ZodTypeAny } from "zod/v3";
import { Page } from "../understudy/page";
import { ModelConfiguration } from "./model";

export interface ActOptions {
  model?: ModelConfiguration;
  variables?: Record<string, string>;
  timeout?: number;
  page?: PlaywrightPage | PuppeteerPage | PatchrightPage | Page;
}

export interface ActResult {
  success: boolean;
  message: string;
  actionDescription: string;
  actions: Action[];
}

export type ExtractResult<T extends z.AnyZodObject> = z.infer<T>;

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

export interface ExtractOptions {
  model?: ModelConfiguration;
  timeout?: number;
  selector?: string;
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
