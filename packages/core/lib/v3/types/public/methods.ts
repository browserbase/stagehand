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
  /**
   * Per-action override of the server cache validation threshold: how many
   * times this action must be seen before the cached result is served.
   * The value persists on the cache entry, so later requests that omit it
   * keep honoring it; passing a new value updates it. Non-negative integer.
   */
  serverCacheThreshold?: number;
  /**
   * When true, attaches detailed cache metadata (`cacheHitCount`,
   * `tokensSaved`, `cacheMissReason`) to the result. `cacheStatus` is always
   * attached when server caching is used, regardless of this flag.
   */
  includeCacheMetadata?: boolean;
}

export interface TokenSavings {
  input: number;
  output: number;
  total: number;
}

export interface ActResult {
  success: boolean;
  message: string;
  actionDescription: string;
  actions: Action[];
  cacheStatus?: "HIT" | "MISS";
  /**
   * Cache entry count after this request. Only attached when
   * `includeCacheMetadata: true` is set on the request options.
   */
  cacheHitCount?: number;
  /**
   * Input, output, and total LLM tokens avoided by a server cache hit.
   * Only attached when `includeCacheMetadata: true` is set on the request
   * options.
   */
  tokensSaved?: TokenSavings;
  /**
   * Why the server cache missed, when it reports a reason (e.g. "threshold",
   * "empty_array", "timeout", "error"). Only attached when
   * `includeCacheMetadata: true` is set on the request options.
   */
  cacheMissReason?: string;
}

export type ExtractResult<T extends StagehandZodSchema> =
  InferStagehandSchema<T> & {
    cacheStatus?: "HIT" | "MISS";
    cacheHitCount?: number;
    tokensSaved?: TokenSavings;
    cacheMissReason?: string;
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
  ignoreSelectors?: string[];
  screenshot?: boolean;
  page?: PlaywrightPage | PuppeteerPage | PatchrightPage | Page;
  /**
   * Override the instance-level serverCache setting for this request.
   * When true, enables server-side caching.
   * When false, disables server-side caching.
   */
  serverCache?: boolean;
  /**
   * Per-action override of the server cache validation threshold: how many
   * times this action must be seen before the cached result is served.
   * The value persists on the cache entry, so later requests that omit it
   * keep honoring it; passing a new value updates it. Non-negative integer.
   */
  serverCacheThreshold?: number;
  /**
   * When true, attaches detailed cache metadata (`cacheHitCount`,
   * `tokensSaved`, `cacheMissReason`) to the result. `cacheStatus` is always
   * attached when server caching is used, regardless of this flag.
   */
  includeCacheMetadata?: boolean;
}

export const defaultExtractSchema = z.object({
  extraction: z.string(),
});

export const pageTextSchema = z.object({
  pageText: z.string(),
});

export interface ObserveOptions {
  model?: ModelConfiguration;
  variables?: Variables;
  timeout?: number;
  selector?: string;
  ignoreSelectors?: string[];
  page?: PlaywrightPage | PuppeteerPage | PatchrightPage | Page;
  /**
   * Override the instance-level serverCache setting for this request.
   * When true, enables server-side caching.
   * When false, disables server-side caching.
   */
  serverCache?: boolean;
  /**
   * Per-action override of the server cache validation threshold: how many
   * times this action must be seen before the cached result is served.
   * The value persists on the cache entry, so later requests that omit it
   * keep honoring it; passing a new value updates it. Non-negative integer.
   */
  serverCacheThreshold?: number;
  /**
   * When true, attaches detailed cache metadata (`cacheHitCount`,
   * `tokensSaved`, `cacheMissReason`) to the result. `cacheStatus` is always
   * attached when server caching is used, regardless of this flag.
   */
  includeCacheMetadata?: boolean;
}

/**
 * Observe returns an array of candidate actions. The optional `cacheStatus`
 * property is attached when the server responds with a
 * `browserbase-cache-status` header so callers can tell whether the result
 * was served from the server-side cache. Detailed fields (`cacheHitCount`,
 * `tokensSaved`, `cacheMissReason`) are only attached when
 * `includeCacheMetadata: true` is set on the request options.
 */
export type ObserveResult = Action[] & {
  cacheStatus?: "HIT" | "MISS";
  cacheHitCount?: number;
  tokensSaved?: TokenSavings;
  cacheMissReason?: string;
};

export enum V3FunctionName {
  ACT = "ACT",
  EXTRACT = "EXTRACT",
  OBSERVE = "OBSERVE",
  AGENT = "AGENT",
}
