import { Page as PatchrightPage } from "patchright-core";
import { Page as PlaywrightPage } from "playwright-core";
import { Page as PuppeteerPage } from "puppeteer-core";
import { z } from "zod";
import type {
  InferStagehandSchema,
  StagehandZodSchema,
} from "../../zodCompat.js";
import { Page } from "../../understudy/page.js";
import { ModelConfiguration } from "../public/model.js";
import type { Variables } from "./agent.js";

export interface ActOptions {
  model?: ModelConfiguration;
  variables?: Variables;
  timeout?: number;
  page?: PlaywrightPage | PuppeteerPage | PatchrightPage | Page;
  /**
   * Override the instance-level serverCache setting for this request.
   * When true, enables server-side caching.
   * When false, disables server-side caching.
   */
  serverCache?: boolean;
}

export interface ActResult {
  success: boolean;
  message: string;
  actionDescription: string;
  actions: Action[];
  cacheStatus?: "HIT" | "MISS";
}

export type ExtractResult<T extends StagehandZodSchema> =
  InferStagehandSchema<T> & {
    cacheStatus?: "HIT" | "MISS";
  };

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
  /**
   * Override the instance-level serverCache setting for this request.
   * When true, enables server-side caching.
   * When false, disables server-side caching.
   */
  serverCache?: boolean;
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
  /**
   * Override the instance-level serverCache setting for this request.
   * When true, enables server-side caching.
   * When false, disables server-side caching.
   */
  serverCache?: boolean;
}

/**
 * Observe returns an array of candidate actions. The optional `cacheStatus`
 * property is attached when the server responds with a
 * `browserbase-cache-status` header so callers can tell whether the result
 * was served from the server-side cache.
 */
export type ObserveResult = Action[] & { cacheStatus?: "HIT" | "MISS" };

export enum V3FunctionName {
  ACT = "ACT",
  EXTRACT = "EXTRACT",
  OBSERVE = "OBSERVE",
  AGENT = "AGENT",
}
