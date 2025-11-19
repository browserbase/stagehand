import { Page as PatchrightPage } from "patchright-core";
import { Page as PlaywrightPage } from "playwright-core";
import { Page as PuppeteerPage } from "puppeteer-core";
import { z } from "zod";
import type { InferStagehandSchema, StagehandZodSchema } from "../../zodCompat";
import { Page } from "../../understudy/page";
import { ModelConfiguration } from "../public/model";

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

export type ExtractResult<T extends StagehandZodSchema> =
  InferStagehandSchema<T>;

export interface Action {
  selector: string;
  description: string;
  method?: string;
  arguments?: string[];
}

export interface HistoryEntry {
  method: "act" | "extract" | "observe" | "navigate" | "agent";
  parameters: unknown;
  result: unknown;
  timestamp: string;
}

export interface ExtractOptions {
  model?: ModelConfiguration;
  timeout?: number;
  selector?: string;
  page?: PlaywrightPage | PuppeteerPage | PatchrightPage | Page;
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

export enum V3FunctionName {
  ACT = "ACT",
  EXTRACT = "EXTRACT",
  OBSERVE = "OBSERVE",
  AGENT = "AGENT",
}
