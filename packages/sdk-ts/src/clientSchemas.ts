/**
 * TypeScript SDK-owned schemas. They extend the protocol's Stagehand init params with local/CDP
 * connection options and JavaScript callbacks that never cross the RPC boundary. Other language
 * SDKs should follow the same pattern around the shared wire params.
 */

import { z } from "zod/v4";
import {
  BrowserbaseBrowserSettingsSchema,
  BrowserbaseSessionCreateParamsSchema,
  LLMGenerateParamsSchema,
  LLMGenerateResultSchema,
  ModelConfigSchema,
  StagehandInitParamsSchema,
} from "../../protocol/schemas.js";
import { LocalBrowserLaunchOptionsSchema } from "../../protocol/pending-schemas.js";

const BrowserbaseClientBrowserSettingsSchema = BrowserbaseBrowserSettingsSchema.omit({
  extensionId: true,
}).strict();

/** Browserbase source fields exposed by the TS SDK. Stagehand provisions its own extension. */
export const BrowserbaseBrowserSourceSchema = BrowserbaseSessionCreateParamsSchema.omit({
  browserSettings: true,
  extensionId: true,
})
  .extend({
    type: z.literal("browserbase"),
    browserSettings: BrowserbaseClientBrowserSettingsSchema.optional(),
  })
  .strict()
  .meta({ id: "BrowserbaseClientBrowserSource" });

export const LocalBrowserSourceSchema = LocalBrowserLaunchOptionsSchema.extend({
  type: z.literal("local"),
})
  .strict()
  .meta({ id: "LocalBrowserSource" });

export const CdpBrowserSourceSchema = z
  .object({
    type: z.literal("cdp"),
    cdpUrl: z.string().min(1),
    headers: z.record(z.string(), z.string()).optional(),
  })
  .strict()
  .meta({ id: "CdpBrowserSource" });

export const BrowserSourceSchema = z
  .discriminatedUnion("type", [
    BrowserbaseBrowserSourceSchema,
    LocalBrowserSourceSchema,
    CdpBrowserSourceSchema,
  ])
  .meta({ id: "BrowserSource" });

/** An LLM callback implemented locally by the SDK consumer. It never crosses the wire. */
export const ClientLLMSchema = z
  .object({
    generate: z.function({
      input: [LLMGenerateParamsSchema],
      output: z.promise(LLMGenerateResultSchema),
    }),
  })
  .strict()
  .meta({ id: "ClientLLM" });

export const StagehandClientInitParamsSchema = StagehandInitParamsSchema.extend({
  browser: BrowserSourceSchema.default({ type: "browserbase" }),
  model: z.union([ModelConfigSchema, ClientLLMSchema]).optional(),
})
  .strict()
  .superRefine((params, context) => {
    if (params.browser.type === "browserbase" && params.apiKey === undefined) {
      context.addIssue({
        code: "custom",
        path: ["apiKey"],
        message: "A Browserbase API key is required for the Browserbase browser source",
      });
    }
  })
  .meta({ id: "StagehandClientInitParams" });

export type ClientLLM = z.infer<typeof ClientLLMSchema>;
export type BrowserSource = z.infer<typeof BrowserSourceSchema>;
export type StagehandClientInitParams = z.input<typeof StagehandClientInitParamsSchema>;
export type ResolvedStagehandClientInitParams = z.output<typeof StagehandClientInitParamsSchema>;
