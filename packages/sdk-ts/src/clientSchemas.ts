/**
 * TypeScript SDK-owned schemas. They extend protocol schemas with SDK-only values such as local/CDP
 * connection options, JavaScript callbacks, and Page instances. Those values are consumed by the
 * SDK and never cross the RPC boundary. Other language SDKs should follow the same pattern around
 * the shared wire params.
 */

import { z } from "zod/v4";
import * as ProtocolSchemas from "../../protocol/schemas.js";
import {
  ActOptionsSchema,
  BrowserbaseBrowserSettingsSchema,
  BrowserbaseSessionCreateParamsSchema,
  ExtractOptionsSchema,
  LLMGenerateParamsSchema,
  LLMGenerateResultSchema,
  LocalBrowserLaunchOptionsSchema,
  ModelConfigSchema,
  ObserveOptionsSchema,
  StagehandInitParamsSchema,
  StagehandLogLevelSchema,
  StagehandLogSchema,
} from "../../protocol/schemas.js";
import { Page } from "./page.js";
import type { StagehandBrowser } from "../../browser/src/index.js";

const BrowserbaseClientBrowserSettingsSchema = BrowserbaseBrowserSettingsSchema.omit({
  extensionId: true,
});

/** Browserbase source fields exposed by the TS SDK. Stagehand provisions its own extension. */
export const BrowserbaseBrowserSourceSchema = BrowserbaseSessionCreateParamsSchema.omit({
  browserSettings: true,
  extensionId: true,
})
  .extend({
    type: z.literal("browserbase"),
    browserSettings: BrowserbaseClientBrowserSettingsSchema.optional(),
  })
  .meta({ id: "BrowserbaseClientBrowserSource" });

export const LocalBrowserSourceSchema = LocalBrowserLaunchOptionsSchema.extend({
  type: z.literal("local"),
}).meta({ id: "LocalBrowserSource" });

export const CdpBrowserSourceSchema = z
  .strictObject({
    type: z.literal("cdp"),
    cdpUrl: z.string().min(1),
    headers: z.record(z.string(), z.string()).optional(),
  })
  .meta({ id: "CdpBrowserSource" });

export const WebMCPToolsOptionsSchema = ProtocolSchemas.WebMCPToolsOptionsSchema.partial();

export const WebMCPInvokeOptionsSchema = ProtocolSchemas.WebMCPInvokeOptionsSchema.partial();

export const WebMCPResultOptionsSchema = ProtocolSchemas.WebMCPResultOptionsSchema;

export const BrowserSourceSchema = z
  .discriminatedUnion("type", [
    BrowserbaseBrowserSourceSchema,
    LocalBrowserSourceSchema,
    CdpBrowserSourceSchema,
  ])
  .meta({ id: "BrowserSource" });

/** An LLM callback implemented locally by the SDK consumer. It never crosses the wire. */
export const ClientLLMSchema = z
  .strictObject({
    generate: z.function({
      input: [LLMGenerateParamsSchema],
      output: z.promise(LLMGenerateResultSchema),
    }),
  })
  .meta({ id: "ClientLLM" });

export const StagehandClientLogLevelSchema = z
  .union([StagehandLogLevelSchema, z.literal("off")])
  .meta({ id: "StagehandClientLogLevel" });

export const StagehandClientLogFormatSchema = z
  .enum(["pretty", "json"])
  .meta({ id: "StagehandClientLogFormat" });

export const StagehandClientOnLogSchema = z
  .function({
    input: [StagehandLogSchema],
    output: z.union([z.void(), z.promise(z.void())]),
  })
  .meta({ id: "StagehandClientOnLog" });

export const StagehandClientLoggingConfigSchema = z
  .strictObject({
    level: StagehandClientLogLevelSchema.default("info"),
    format: StagehandClientLogFormatSchema.default("pretty"),
    onLog: StagehandClientOnLogSchema.optional(),
  })
  .meta({ id: "StagehandClientLoggingConfig" });

export const StagehandClientActOptionsSchema = ActOptionsSchema.extend({
  page: z.instanceof(Page).optional(),
}).meta({ id: "StagehandClientActOptions" });

export const StagehandClientObserveOptionsSchema = ObserveOptionsSchema.extend({
  page: z.instanceof(Page).optional(),
}).meta({ id: "StagehandClientObserveOptions" });

export const StagehandClientExtractOptionsSchema = ExtractOptionsSchema.extend({
  page: z.instanceof(Page).optional(),
}).meta({ id: "StagehandClientExtractOptions" });

export const StagehandClientInitParamsSchema = StagehandInitParamsSchema.extend({
  browser: BrowserSourceSchema.default({ type: "browserbase" }),
  model: z.union([ModelConfigSchema, ClientLLMSchema]).optional(),
  logging: StagehandClientLoggingConfigSchema.default({
    level: "info",
    format: "pretty",
  }),
})
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

export const StagehandClientCreateConfigSchema = StagehandInitParamsSchema.omit({
  apiKey: true,
  browser: true,
})
  .extend({
    model: z.union([ModelConfigSchema, ClientLLMSchema]).optional(),
    logging: StagehandClientLoggingConfigSchema.default({
      level: "info",
      format: "pretty",
    }),
  })
  .strict()
  .meta({ id: "StagehandClientCreateConfig" });

export type ClientLLM = z.infer<typeof ClientLLMSchema>;
export type StagehandClientLoggingConfig = z.input<typeof StagehandClientLoggingConfigSchema>;
export type ResolvedStagehandClientLoggingConfig = z.output<
  typeof StagehandClientLoggingConfigSchema
>;
export type StagehandClientActOptions = z.input<typeof StagehandClientActOptionsSchema>;
export type StagehandClientObserveOptions = z.input<typeof StagehandClientObserveOptionsSchema>;
export type StagehandClientExtractOptions = z.input<typeof StagehandClientExtractOptionsSchema>;
export type BrowserSource = z.infer<typeof BrowserSourceSchema>;
export type StagehandClientInitParams = z.input<typeof StagehandClientInitParamsSchema>;
export type ResolvedStagehandClientInitParams = z.output<typeof StagehandClientInitParamsSchema>;
export type StagehandClientCreateConfig = z.input<typeof StagehandClientCreateConfigSchema>;
export type ResolvedStagehandClientCreateConfig = z.output<
  typeof StagehandClientCreateConfigSchema
>;
export type StagehandClientCreateParams = StagehandClientCreateConfig & {
  browser: StagehandBrowser;
};
export type StagehandCreateOptions = StagehandClientCreateParams;
export type WebMCPToolsOptions = z.infer<typeof WebMCPToolsOptionsSchema>;
export type WebMCPInvokeOptions = z.infer<typeof WebMCPInvokeOptionsSchema>;
export type WebMCPResultOptions = z.infer<typeof WebMCPResultOptionsSchema>;
