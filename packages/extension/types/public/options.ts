import type { z } from "zod/v4";
import {
  BrowserbaseConnectOptionsSchema,
  BrowserbaseSessionCreateParamsSchema,
  LocalBrowserConnectOptionsSchema,
  LocalBrowserLaunchOptionsSchema,
  StagehandOptionsSchema,
} from "./schemas.js";

// Re-export for backwards compatibility (camelCase alias)
export const localBrowserLaunchOptionsSchema = LocalBrowserLaunchOptionsSchema;

export type LocalBrowserLaunchOptions = z.infer<typeof LocalBrowserLaunchOptionsSchema>;
export type LocalBrowserConnectOptions = z.infer<typeof LocalBrowserConnectOptionsSchema>;
export type BrowserbaseSessionCreateParams = z.infer<typeof BrowserbaseSessionCreateParamsSchema>;
export type BrowserbaseConnectOptions = z.infer<typeof BrowserbaseConnectOptionsSchema>;

/** Constructor options for Stagehand */
export type StagehandOptions = z.infer<typeof StagehandOptionsSchema>;
