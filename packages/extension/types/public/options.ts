import type { z } from "zod/v4";
import { LocalBrowserLaunchOptionsSchema, V3EnvSchema, V3OptionsSchema } from "./schemas.js";

export type V3Env = z.infer<typeof V3EnvSchema>;

// Re-export for backwards compatibility (camelCase alias)
export const localBrowserLaunchOptionsSchema = LocalBrowserLaunchOptionsSchema;

export type LocalBrowserLaunchOptions = z.infer<typeof LocalBrowserLaunchOptionsSchema>;

/** Constructor options for V3 */
export type V3Options = z.infer<typeof V3OptionsSchema>;
