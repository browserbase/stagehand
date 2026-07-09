import type { z } from "zod/v4";
import type { ModelConfiguration } from "./model.js";
import type { Locator } from "./page.js";
import type { Variables } from "./variables.js";
import { V3FunctionNameSchema } from "./schemas.js";
export { defaultExtractSchema, pageTextSchema } from "./schemas.js";

export interface ActOptions {
  model?: ModelConfiguration;
  variables?: Variables;
  timeout?: number;
  locator?: Locator;
  /**
   * Override the instance-level serverCache setting for this request.
   * When true, enables server-side caching.
   * When false, disables server-side caching.
   */
  serverCache?: boolean;
}

export interface ActResultData {
  success: boolean;
  message: string;
  actionDescription: string;
  actions: Action[];
}

export interface ActResult {
  result: ActResultData;
  actionId?: string;
  cacheStatus?: "HIT" | "MISS";
}

export type ExtractResult<T extends z.ZodType> = {
  result: z.infer<T>;
  actionId?: string;
  cacheStatus?: "HIT" | "MISS";
};

export interface Action {
  selector: string;
  description: string;
  method?: string;
  arguments?: string[];
}

export interface HistoryEntry {
  method: "act" | "extract" | "observe" | "navigate";
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
  locator?: Locator;
  /**
   * Override the instance-level serverCache setting for this request.
   * When true, enables server-side caching.
   * When false, disables server-side caching.
   */
  serverCache?: boolean;
}

export interface ObserveOptions {
  model?: ModelConfiguration;
  variables?: Variables;
  timeout?: number;
  selector?: string;
  ignoreSelectors?: string[];
  locator?: Locator;
  /**
   * Override the instance-level serverCache setting for this request.
   * When true, enables server-side caching.
   * When false, disables server-side caching.
   */
  serverCache?: boolean;
}

export interface ObserveResult {
  result: Action[];
  actionId?: string;
  cacheStatus?: "HIT" | "MISS";
}

export const V3FunctionName = {
  ACT: "ACT",
  EXTRACT: "EXTRACT",
  OBSERVE: "OBSERVE",
} as const;

export type V3FunctionName = z.infer<typeof V3FunctionNameSchema>;
