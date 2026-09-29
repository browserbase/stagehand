/**
 * TypeScript SDK-owned schemas. They extend protocol schemas with SDK-only values such as local/CDP
 * connection options, JavaScript callbacks, and Page instances. Those values are consumed by the
 * SDK and never cross the RPC boundary. Other language SDKs should follow the same pattern around
 * the shared wire params.
 */

import { z } from "zod/v4";
import type Browserbase from "@browserbasehq/sdk";
import * as ProtocolSchemas from "@browserbasehq/stagehand-protocol/schemas";
import type { StagehandLog } from "@browserbasehq/stagehand-protocol/types";
import {
  ActOptionsSchema,
  BrowserbaseRegionSchema,
  ExtractOptionsSchema,
  LLMGenerateParamsSchema,
  LLMGenerateResultSchema,
  ModelConfigSchema,
  ObserveOptionsSchema,
  StagehandInitParamsSchema,
  StagehandLogLevelSchema,
} from "@browserbasehq/stagehand-protocol/schemas";
import { Page } from "./page.js";
import { Locator } from "./locator.js";
import { isStagehandBrowser, type StagehandBrowser } from "./browser/index.js";

export const LocalBrowserLaunchOptionsSchema = z
  .strictObject({
    args: z.array(z.string()).optional(),
    executablePath: z.string().optional(),
    port: z.number().optional(),
    userDataDir: z.string().optional(),
    preserveUserDataDir: z.boolean().optional(),
    headless: z.boolean().optional(),
    devtools: z.boolean().optional(),
    chromiumSandbox: z.boolean().optional(),
    ignoreDefaultArgs: z.union([z.boolean(), z.array(z.string())]).optional(),
    proxy: z
      .strictObject({
        server: z.string(),
        bypass: z.string().optional(),
        username: z.string().optional(),
        password: z.string().optional(),
      })
      .optional(),
    locale: z.string().optional(),
    viewport: z.strictObject({ width: z.number(), height: z.number() }).optional(),
    deviceScaleFactor: z.number().optional(),
    hasTouch: z.boolean().optional(),
    ignoreHTTPSErrors: z.boolean().optional(),
    downloadsPath: z.string().optional(),
    acceptDownloads: z.boolean().optional(),
    keepAlive: z.boolean().optional(),
  })
  .meta({ id: "LocalBrowserLaunchOptions" });

export const LocalBrowserConnectOptionsSchema = z
  .strictObject({
    cdpUrl: z.string().min(1),
    extensionId: z.string().min(1).optional(),
  })
  .meta({ id: "LocalBrowserConnectOptions" });

export const DEFAULT_BROWSERBASE_URL = "https://api.browserbase.com";

type BrowserbaseLaunchOptionsInput = Browserbase.SessionCreateParams & {
  apiKey: string;
  baseUrl?: string;
};

type BrowserbaseLaunchOptionsOutput = Browserbase.SessionCreateParams & {
  apiKey: string;
  baseUrl: string;
};

/**
 * Browserbase owns the session option surface. Keep this object loose so newly added SDK options
 * pass through without requiring a Stagehand protocol or schema update.
 */
export const BrowserbaseLaunchOptionsSchema = z
  .looseObject({
    apiKey: z.string().min(1),
    baseUrl: z.url().default(DEFAULT_BROWSERBASE_URL),
    apiUrl: z.never().optional(),
    type: z.never().optional(),
  })
  .meta({ id: "BrowserbaseLaunchOptions" }) as z.ZodType<
  BrowserbaseLaunchOptionsOutput,
  BrowserbaseLaunchOptionsInput
>;

export const BrowserbaseConnectOptionsSchema = z
  .strictObject({
    apiKey: z.string().min(1),
    baseUrl: z.url().default(DEFAULT_BROWSERBASE_URL),
    sessionId: z.string().min(1),
    extensionId: z.string().min(1).optional(),
  })
  .meta({ id: "BrowserbaseConnectOptions" });

const BrowserbaseClientOptionsSchema = {
  apiKey: z.string().min(1),
  baseUrl: z.url().default(DEFAULT_BROWSERBASE_URL),
};

export const BrowserbaseSearchOptionsSchema = z
  .strictObject({
    ...BrowserbaseClientOptionsSchema,
    query: z.string().min(1).max(200),
    numResults: z.int().min(1).max(25).optional(),
  })
  .meta({ id: "BrowserbaseSearchOptions" });

export const BrowserbaseFetchOptionsSchema = z
  .strictObject({
    ...BrowserbaseClientOptionsSchema,
    url: z.url(),
    allowInsecureSsl: z.boolean().optional(),
    allowRedirects: z.boolean().optional(),
    format: z.enum(["raw", "json", "markdown"]).optional(),
    proxies: z.boolean().optional(),
    schema: z.record(z.string(), z.unknown()).optional(),
  })
  .refine(({ format, schema }) => schema === undefined || format === "json", {
    message: 'schema is only valid when format is "json"',
    path: ["schema"],
  })
  .refine(({ format, schema }) => format !== "json" || schema !== undefined, {
    message: 'schema is required when format is "json"',
    path: ["schema"],
  })
  .meta({ id: "BrowserbaseFetchOptions" });

export const BrowserbaseSearchResultSchema = z
  .object({
    query: z.string(),
    requestId: z.string(),
    results: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        url: z.string(),
        author: z.string().nullish(),
        favicon: z.string().nullish(),
        image: z.string().nullish(),
        publishedDate: z.string().nullish(),
      }),
    ),
  })
  .meta({ id: "BrowserbaseSearchResult" });

export const BrowserbaseFetchResultSchema = z
  .object({
    id: z.string(),
    content: z.union([z.string(), z.record(z.string(), z.unknown())]),
    contentType: z.string(),
    encoding: z.string(),
    headers: z.record(z.string(), z.string()),
    statusCode: z.number().int(),
  })
  .meta({ id: "BrowserbaseFetchResult" });

/** Data returned by the Browserbase SDK after creating a session. */
export const BrowserbaseSessionCreateResultSchema = z
  .object({
    id: z.string(),
    connectUrl: z.string(),
  })
  .meta({ id: "BrowserbaseSessionCreateResult" });

/** Data returned by the Browserbase SDK when retrieving a session. */
export const BrowserbaseSessionRetrieveResultSchema = z
  .object({
    id: z.string(),
    connectUrl: z.string().optional(),
    region: BrowserbaseRegionSchema.optional(),
  })
  .meta({ id: "BrowserbaseSessionRetrieveResult" });

/** Normalized connection data shared by Browserbase launch and connect flows. */
export const BrowserbaseSessionConnectionSchema = z
  .strictObject({
    sessionId: z.string().trim().min(1),
    cdpUrl: z.string().trim().min(1),
    region: BrowserbaseRegionSchema.optional(),
  })
  .meta({ id: "BrowserbaseSessionConnection" });

export const WebMCPToolsOptionsSchema = ProtocolSchemas.WebMCPToolsOptionsSchema.partial();

export const WebMCPInvokeOptionsSchema = ProtocolSchemas.WebMCPInvokeOptionsSchema.partial();

export const WebMCPResultOptionsSchema = ProtocolSchemas.WebMCPResultOptionsSchema;

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
  .custom<(log: StagehandLog) => void | Promise<void>>(
    (value) => typeof value === "function",
    "onLog must be a function",
  )
  .meta({ id: "StagehandClientOnLog" });

export const StagehandClientLoggingConfigSchema = z
  .strictObject({
    level: StagehandClientLogLevelSchema.default("info"),
    format: StagehandClientLogFormatSchema.default("pretty"),
    onLog: StagehandClientOnLogSchema.optional(),
  })
  .meta({ id: "StagehandClientLoggingConfig" });

export const StagehandClientActOptionsSchema = ActOptionsSchema.extend({
  locator: z.instanceof(Locator).optional(),
  ignoreLocators: z.array(z.instanceof(Locator)).optional(),
  page: z.instanceof(Page).optional(),
}).meta({ id: "StagehandClientActOptions" });

export const StagehandClientObserveOptionsSchema = ObserveOptionsSchema.extend({
  locator: z.instanceof(Locator).optional(),
  ignoreLocators: z.array(z.instanceof(Locator)).optional(),
  page: z.instanceof(Page).optional(),
}).meta({ id: "StagehandClientObserveOptions" });

export const StagehandClientExtractOptionsSchema = ExtractOptionsSchema.extend({
  locator: z.instanceof(Locator).optional(),
  ignoreLocators: z.array(z.instanceof(Locator)).optional(),
  page: z.instanceof(Page).optional(),
}).meta({ id: "StagehandClientExtractOptions" });

export const StagehandClientCreateConfigSchema = StagehandInitParamsSchema.omit({
  protocolVersion: true,
  clientInfo: true,
  browserCdpUrl: true,
  logLevel: true,
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

export const StagehandBrowserSchema = z
  .custom<StagehandBrowser>(
    isStagehandBrowser,
    "browser must be created by localBrowser or browserbase",
  )
  .meta({ id: "StagehandBrowser" });

export const StagehandCreateOptionsSchema = StagehandClientCreateConfigSchema.extend({
  browser: StagehandBrowserSchema,
}).meta({ id: "StagehandCreateOptions" });

export type ClientLLM = z.infer<typeof ClientLLMSchema>;
export type StagehandClientLoggingConfig = z.input<typeof StagehandClientLoggingConfigSchema>;
export type ResolvedStagehandClientLoggingConfig = z.output<
  typeof StagehandClientLoggingConfigSchema
>;
export type StagehandClientActOptions = z.input<typeof StagehandClientActOptionsSchema>;
export type StagehandClientObserveOptions = z.input<typeof StagehandClientObserveOptionsSchema>;
export type StagehandClientExtractOptions = z.input<typeof StagehandClientExtractOptionsSchema>;
export type LocalBrowserLaunchOptions = z.infer<typeof LocalBrowserLaunchOptionsSchema>;
export type LocalBrowserConnectOptions = z.infer<typeof LocalBrowserConnectOptionsSchema>;
export type BrowserbaseLaunchOptions = z.input<typeof BrowserbaseLaunchOptionsSchema>;
export type BrowserbaseConnectOptions = z.input<typeof BrowserbaseConnectOptionsSchema>;
export type BrowserbaseSearchOptions = z.input<typeof BrowserbaseSearchOptionsSchema>;
export type BrowserbaseFetchOptions = z.input<typeof BrowserbaseFetchOptionsSchema>;
export type BrowserbaseSearchResult = z.infer<typeof BrowserbaseSearchResultSchema>;
export type BrowserbaseFetchResult = z.infer<typeof BrowserbaseFetchResultSchema>;
export type BrowserbaseSessionCreateResult = z.infer<typeof BrowserbaseSessionCreateResultSchema>;
export type BrowserbaseSessionRetrieveResult = z.infer<
  typeof BrowserbaseSessionRetrieveResultSchema
>;
export type BrowserbaseSessionConnection = z.infer<typeof BrowserbaseSessionConnectionSchema>;
export type StagehandClientCreateConfig = z.input<typeof StagehandClientCreateConfigSchema>;
export type ResolvedStagehandClientCreateConfig = z.output<
  typeof StagehandClientCreateConfigSchema
>;
export type StagehandCreateOptions = z.input<typeof StagehandCreateOptionsSchema>;
export type ResolvedStagehandCreateOptions = z.output<typeof StagehandCreateOptionsSchema>;
export type WebMCPToolsOptions = z.infer<typeof WebMCPToolsOptionsSchema>;
export type WebMCPInvokeOptions = z.infer<typeof WebMCPInvokeOptionsSchema>;
export type WebMCPResultOptions = z.infer<typeof WebMCPResultOptionsSchema>;
