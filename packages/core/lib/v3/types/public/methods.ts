import { Page as PatchrightPage } from "patchright-core";
import { Page as PlaywrightPage } from "playwright-core";
import { Page as PuppeteerPage } from "puppeteer-core";
import { z } from "zod";
import type { InferStagehandSchema, StagehandZodSchema } from "../../zodCompat";
import { Page } from "../../understudy/page";
import { ModelConfiguration } from "../public/model";
import { AnyPage } from "./page";

declare const SCRAPE_ID_BRAND: unique symbol;
export type ScrapeElementId = string & { [SCRAPE_ID_BRAND]: true };

export const SCRAPE_SCHEMA_FIELD = "__stagehandScrapeSchema";

export interface ScrapeElementReference {
  id: ScrapeElementId;
  xpath?: string;
}

export type ScrapedValue<T> = T extends readonly (infer U)[]
  ? readonly ScrapedValue<U>[]
  : T extends Array<infer U>
    ? Array<ScrapedValue<U>>
    : T extends object
      ? { [K in keyof T]: ScrapedValue<T[K]> }
      : T extends null
        ? null
        : T extends undefined
          ? undefined
          : ScrapeElementReference;

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

export type ScrapeResult<T extends StagehandZodSchema> = ScrapedValue<
  InferStagehandSchema<T>
> & {
  resolve: (options?: { page?: AnyPage }) => Promise<InferStagehandSchema<T>>;
  __stagehandScrapeSchema?: T;
};

export interface Action {
  selector: string;
  description: string;
  method?: string;
  arguments?: string[];
}

export interface HistoryEntry {
  method: "act" | "extract" | "scrape" | "observe" | "navigate" | "agent";
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

export interface ScrapeOptions {
  model?: ModelConfiguration;
  timeout?: number;
  selector?: string;
  page?: PlaywrightPage | PuppeteerPage | PatchrightPage | Page;
}

export const defaultExtractSchema = z.object({
  extraction: z.string(),
});

export const defaultScrapeSchema = z.object({
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
  SCRAPE = "SCRAPE",
  OBSERVE = "OBSERVE",
  AGENT = "AGENT",
}
