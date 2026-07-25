/**
 * TypeScript SDK-owned schemas. They extend protocol schemas with SDK-only values such as local/CDP
 * connection options, JavaScript callbacks, and Page instances. Those values are consumed by the
 * SDK and never cross the RPC boundary. Other language SDKs should follow the same pattern around
 * the shared wire params.
 */

import { z } from "zod/v4";
import {
  ActOptionsSchema,
  BrowserbaseBrowserSettingsSchema,
  BrowserbaseSessionCreateParamsSchema,
  ExtractOptionsSchema,
  LLMGenerateParamsSchema,
  LLMGenerateResultSchema,
  ModelConfigSchema,
  ObserveOptionsSchema,
  StagehandInitParamsSchema,
  StagehandLogLevelSchema,
  StagehandLogSchema,
} from "../../protocol/schemas.js";
import { LocalBrowserLaunchOptionsSchema } from "../../protocol/pending-schemas.js";
import { Page } from "./page.js";

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

export const StagehandClientActOptionsSchema = ActOptionsSchema.unwrap()
  .extend({
    page: z.instanceof(Page).optional(),
  })
  .strict()
  .meta({ id: "StagehandClientActOptions" });

export const StagehandClientObserveOptionsSchema = ObserveOptionsSchema.unwrap()
  .extend({
    page: z.instanceof(Page).optional(),
  })
  .strict()
  .meta({ id: "StagehandClientObserveOptions" });

export const StagehandClientExtractOptionsSchema = ExtractOptionsSchema.unwrap()
  .extend({
    page: z.instanceof(Page).optional(),
  })
  .strict()
  .meta({ id: "StagehandClientExtractOptions" });

export function createStagehandClientInitParamsSchema<
  BrowserSourceSchema extends z.ZodType<
    | z.output<typeof BrowserbaseBrowserSourceSchema>
    | z.output<typeof LocalBrowserSourceSchema>
    | z.output<typeof CdpBrowserSourceSchema>
  >,
>(browserSourceSchema: BrowserSourceSchema) {
  return StagehandInitParamsSchema.extend({
    browser: browserSourceSchema.optional().transform(
      (browser) =>
        browser ??
        browserSourceSchema.parse({
          type: "browserbase",
        }),
    ),
    model: z.union([ModelConfigSchema, ClientLLMSchema]).optional(),
    logging: StagehandClientLoggingConfigSchema.default({
      level: "info",
      format: "pretty",
    }),
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
}

export type ClientLLM = z.infer<typeof ClientLLMSchema>;
export type StagehandClientLoggingConfig = z.input<typeof StagehandClientLoggingConfigSchema>;
export type ResolvedStagehandClientLoggingConfig = z.output<
  typeof StagehandClientLoggingConfigSchema
>;
export type StagehandClientActOptions = z.input<typeof StagehandClientActOptionsSchema>;
export type StagehandClientObserveOptions = z.input<typeof StagehandClientObserveOptionsSchema>;
export type StagehandClientExtractOptions = z.input<typeof StagehandClientExtractOptionsSchema>;
