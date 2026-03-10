import { z } from "zod/v4";
import { Api } from "@browserbasehq/stagehand";

export const BrowserSessionIdSchema = z
  .string()
  .min(1)
  .meta({ id: "BrowserSessionId", example: "session_01JXAMPLE" });

export const BrowserSessionEnvSchema = z
  .enum(["LOCAL", "BROWSERBASE"])
  .meta({ id: "BrowserSessionEnv" });

export const BrowserSessionStatusSchema = z
  .enum(["running", "ended"])
  .meta({ id: "BrowserSessionStatus" });

export const BrowserSessionHeadersSchema = Api.SessionHeadersSchema.meta({
  id: "BrowserSessionHeaders",
});

export const BrowserSessionErrorResponseSchema = z
  .object({
    success: z.literal(false),
    message: z.string(),
  })
  .strict()
  .meta({ id: "BrowserSessionErrorResponse" });

const BrowserSessionCommonSchema = z
  .object({
    modelName: z.string().meta({
      description: "Model name to use for AI operations",
      example: "openai/gpt-4.1-nano",
    }),
    domSettleTimeoutMs: z.number().optional(),
    verbose: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
    systemPrompt: z.string().optional(),
    selfHeal: z.boolean().optional(),
    waitForCaptchaSolves: z.boolean().optional(),
    experimental: z.boolean().optional(),
    actTimeoutMs: z.number().optional(),
  })
  .strict();

const BrowserSessionLocalCreateSchema = BrowserSessionCommonSchema.extend({
  env: z.literal("LOCAL"),
  cdpUrl: z.string().optional(),
  localBrowserLaunchOptions: Api.LocalBrowserLaunchOptionsSchema.optional(),
})
  .strict()
  .superRefine((value, ctx) => {
    if (!value.cdpUrl && !value.localBrowserLaunchOptions) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["localBrowserLaunchOptions"],
        message:
          "When env is LOCAL, provide either cdpUrl or localBrowserLaunchOptions.",
      });
    }
  })
  .meta({ id: "BrowserSessionLocalCreateRequest" });

const BrowserSessionBrowserbaseCreateSchema = BrowserSessionCommonSchema.extend({
  env: z.literal("BROWSERBASE"),
  browserbaseSessionId: z.string().optional(),
  browserbaseSessionCreateParams:
    Api.BrowserbaseSessionCreateParamsSchema.optional(),
})
  .strict()
  .meta({ id: "BrowserSessionBrowserbaseCreateRequest" });

export const BrowserSessionCreateRequestSchema = z
  .discriminatedUnion("env", [
    BrowserSessionLocalCreateSchema,
    BrowserSessionBrowserbaseCreateSchema,
  ])
  .meta({ id: "BrowserSessionCreateRequest" });

export const BrowserSessionIdParamsSchema = z
  .object({
    id: BrowserSessionIdSchema,
  })
  .strict()
  .meta({ id: "BrowserSessionIdParams" });

export const BrowserSessionEndRequestSchema = z
  .object({})
  .strict()
  .optional()
  .meta({ id: "BrowserSessionEndRequest" });

export const BrowserSessionSchema = z
  .object({
    id: BrowserSessionIdSchema,
    env: BrowserSessionEnvSchema,
    status: BrowserSessionStatusSchema,
    modelName: z.string(),
    cdpUrl: z.string().nullish(),
    available: z.boolean(),
    browserbaseSessionId: z.string().optional(),
    browserbaseSessionCreateParams:
      Api.BrowserbaseSessionCreateParamsSchema.optional(),
    localBrowserLaunchOptions: Api.LocalBrowserLaunchOptionsSchema.optional(),
    domSettleTimeoutMs: z.number().optional(),
    verbose: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
    systemPrompt: z.string().optional(),
    selfHeal: z.boolean().optional(),
    waitForCaptchaSolves: z.boolean().optional(),
    experimental: z.boolean().optional(),
    actTimeoutMs: z.number().optional(),
  })
  .strict()
  .meta({ id: "BrowserSession" });

export const BrowserSessionResultSchema = z
  .object({
    browserSession: BrowserSessionSchema,
  })
  .strict()
  .meta({ id: "BrowserSessionResult" });

export const BrowserSessionResponseSchema = z
  .object({
    success: z.literal(true),
    data: BrowserSessionResultSchema,
  })
  .strict()
  .meta({ id: "BrowserSessionResponse" });

export const browserSessionOpenApiComponents = {
  schemas: {
    LocalBrowserLaunchOptions: Api.LocalBrowserLaunchOptionsSchema,
    BrowserbaseSessionCreateParams: Api.BrowserbaseSessionCreateParamsSchema,
    BrowserSessionHeaders: BrowserSessionHeadersSchema,
    BrowserSessionId: BrowserSessionIdSchema,
    BrowserSessionEnv: BrowserSessionEnvSchema,
    BrowserSessionStatus: BrowserSessionStatusSchema,
    BrowserSessionCreateRequest: BrowserSessionCreateRequestSchema,
    BrowserSessionIdParams: BrowserSessionIdParamsSchema,
    BrowserSessionEndRequest: BrowserSessionEndRequestSchema,
    BrowserSession: BrowserSessionSchema,
    BrowserSessionResult: BrowserSessionResultSchema,
    BrowserSessionResponse: BrowserSessionResponseSchema,
    BrowserSessionErrorResponse: BrowserSessionErrorResponseSchema,
  },
};

export type BrowserSessionCreateRequest = z.infer<
  typeof BrowserSessionCreateRequestSchema
>;
export type BrowserSessionIdParams = z.infer<
  typeof BrowserSessionIdParamsSchema
>;
export type BrowserSession = z.infer<typeof BrowserSessionSchema>;
