import { z } from "zod/v4";
import { Api } from "@browserbasehq/stagehand";
import {
  ActionIdSchema,
  FrameIdSchema,
  PageHeadersSchema,
  PageIdSchema,
  PageInitScriptSchema,
  RequestIdSchema,
  TimestampSchema,
} from "./page.js";

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

const BrowserSessionBrowserbaseCreateSchema = BrowserSessionCommonSchema.extend(
  {
    env: z.literal("BROWSERBASE"),
    browserbaseSessionId: z.string().optional(),
    browserbaseSessionCreateParams:
      Api.BrowserbaseSessionCreateParamsSchema.optional(),
  },
)
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

export const BrowserSessionActionMethodSchema = z
  .enum([
    "addInitScript",
    "setExtraHTTPHeaders",
    "pages",
    "activePage",
    "awaitActivePage",
    "resolvePageByMainFrameId",
    "getFullFrameTreeByMainFrameId",
    "newPage",
    "cookies",
    "addCookies",
    "clearCookies",
    "connectURL",
    "configuredViewport",
    "browserbaseSessionID",
    "browserbaseSessionURL",
    "browserbaseDebugURL",
    "isBrowserbase",
    "isAdvancedStealth",
    "setViewportSize",
    "close",
  ])
  .meta({ id: "BrowserSessionActionMethod" });

export const BrowserSessionActionStatusSchema = z
  .enum(["queued", "running", "completed", "failed", "canceled"])
  .meta({ id: "BrowserSessionActionStatus" });

export const BrowserSessionPageSchema = z
  .object({
    pageId: PageIdSchema,
    targetId: PageIdSchema,
    mainFrameId: FrameIdSchema,
    url: z.string(),
  })
  .strict()
  .meta({ id: "BrowserSessionPage" });

export const BrowserSessionCookieSchema = z
  .object({
    name: z.string(),
    value: z.string(),
    domain: z.string(),
    path: z.string(),
    expires: z.number(),
    httpOnly: z.boolean(),
    secure: z.boolean(),
    sameSite: z.enum(["Strict", "Lax", "None"]),
  })
  .strict()
  .meta({ id: "BrowserSessionCookie" });

export const BrowserSessionCookieParamSchema = z
  .object({
    name: z.string(),
    value: z.string(),
    url: z.string().optional(),
    domain: z.string().optional(),
    path: z.string().optional(),
    expires: z.number().optional(),
    httpOnly: z.boolean().optional(),
    secure: z.boolean().optional(),
    sameSite: z.enum(["Strict", "Lax", "None"]).optional(),
  })
  .strict()
  .meta({ id: "BrowserSessionCookieParam" });

export const BrowserSessionRegexSchema = z
  .object({
    source: z.string(),
    flags: z.string().optional(),
  })
  .strict()
  .meta({ id: "BrowserSessionRegex" });

export const BrowserSessionStringPatternSchema = z
  .union([z.string(), BrowserSessionRegexSchema])
  .meta({ id: "BrowserSessionStringPattern" });

export const BrowserSessionClearCookiesOptionsSchema = z
  .object({
    name: BrowserSessionStringPatternSchema.optional(),
    domain: BrowserSessionStringPatternSchema.optional(),
    path: BrowserSessionStringPatternSchema.optional(),
  })
  .strict()
  .meta({ id: "BrowserSessionClearCookiesOptions" });

export const BrowserSessionViewportSchema = z
  .object({
    width: z.number().positive(),
    height: z.number().positive(),
    deviceScaleFactor: z.number().positive().optional(),
  })
  .strict()
  .meta({ id: "BrowserSessionViewport" });

const BrowserSessionBodySchema = z
  .object({
    id: RequestIdSchema.optional(),
    sessionId: BrowserSessionIdSchema,
  })
  .strict();

const BrowserSessionActionBaseSchema = z
  .object({
    id: ActionIdSchema,
    method: BrowserSessionActionMethodSchema,
    status: BrowserSessionActionStatusSchema,
    sessionId: BrowserSessionIdSchema,
    pageId: PageIdSchema.optional(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    completedAt: TimestampSchema.optional(),
    error: z.string().nullable(),
  })
  .strict()
  .meta({ id: "BrowserSessionActionBase" });

function createBrowserSessionRequestSchema<T extends z.ZodTypeAny>(
  id: string,
  params: T,
) {
  return BrowserSessionBodySchema.extend({ params }).meta({ id });
}

function createBrowserSessionActionSchema<
  TMethod extends BrowserSessionActionMethod,
  TParams extends z.ZodTypeAny,
  TResult extends z.ZodTypeAny,
>(id: string, method: TMethod, params: TParams, result: TResult) {
  return BrowserSessionActionBaseSchema.extend({
    method: z.literal(method),
    params,
    result: result.nullable(),
  }).meta({ id });
}

function createBrowserSessionResponseSchema<T extends z.ZodTypeAny>(
  id: string,
  action: T,
) {
  return z
    .object({
      success: z.literal(true),
      error: z.null(),
      action,
    })
    .strict()
    .meta({ id });
}

export const BrowserSessionAddInitScriptParamsSchema = z
  .object({
    script: PageInitScriptSchema,
  })
  .strict()
  .meta({ id: "BrowserSessionAddInitScriptParams" });

export const BrowserSessionSetExtraHTTPHeadersParamsSchema = z
  .object({
    headers: PageHeadersSchema,
  })
  .strict()
  .meta({ id: "BrowserSessionSetExtraHTTPHeadersParams" });

export const BrowserSessionPagesParamsSchema = z
  .object({})
  .strict()
  .meta({ id: "BrowserSessionPagesParams" });

export const BrowserSessionActivePageParamsSchema = z
  .object({})
  .strict()
  .meta({ id: "BrowserSessionActivePageParams" });

export const BrowserSessionAwaitActivePageParamsSchema = z
  .object({
    timeoutMs: z.number().int().nonnegative().optional(),
  })
  .strict()
  .meta({ id: "BrowserSessionAwaitActivePageParams" });

export const BrowserSessionResolvePageByMainFrameIdParamsSchema = z
  .object({
    mainFrameId: FrameIdSchema,
  })
  .strict()
  .meta({ id: "BrowserSessionResolvePageByMainFrameIdParams" });

export const BrowserSessionGetFullFrameTreeByMainFrameIdParamsSchema = z
  .object({
    mainFrameId: FrameIdSchema,
  })
  .strict()
  .meta({ id: "BrowserSessionGetFullFrameTreeByMainFrameIdParams" });

export const BrowserSessionNewPageParamsSchema = z
  .object({
    url: z.string().optional(),
  })
  .strict()
  .meta({ id: "BrowserSessionNewPageParams" });

export const BrowserSessionCookiesParamsSchema = z
  .object({
    urls: z.union([z.string(), z.array(z.string())]).optional(),
  })
  .strict()
  .meta({ id: "BrowserSessionCookiesParams" });

export const BrowserSessionAddCookiesParamsSchema = z
  .object({
    cookies: z.array(BrowserSessionCookieParamSchema),
  })
  .strict()
  .meta({ id: "BrowserSessionAddCookiesParams" });

export const BrowserSessionClearCookiesParamsSchema =
  BrowserSessionClearCookiesOptionsSchema.meta({
    id: "BrowserSessionClearCookiesParams",
  });

export const BrowserSessionConnectURLParamsSchema = z
  .object({})
  .strict()
  .meta({ id: "BrowserSessionConnectURLParams" });

export const BrowserSessionConfiguredViewportParamsSchema = z
  .object({})
  .strict()
  .meta({ id: "BrowserSessionConfiguredViewportParams" });

export const BrowserSessionBrowserbaseSessionIDParamsSchema = z
  .object({})
  .strict()
  .meta({ id: "BrowserSessionBrowserbaseSessionIDParams" });

export const BrowserSessionBrowserbaseSessionURLParamsSchema = z
  .object({})
  .strict()
  .meta({ id: "BrowserSessionBrowserbaseSessionURLParams" });

export const BrowserSessionBrowserbaseDebugURLParamsSchema = z
  .object({})
  .strict()
  .meta({ id: "BrowserSessionBrowserbaseDebugURLParams" });

export const BrowserSessionIsBrowserbaseParamsSchema = z
  .object({})
  .strict()
  .meta({ id: "BrowserSessionIsBrowserbaseParams" });

export const BrowserSessionIsAdvancedStealthParamsSchema = z
  .object({})
  .strict()
  .meta({ id: "BrowserSessionIsAdvancedStealthParams" });

export const BrowserSessionSetViewportSizeParamsSchema =
  BrowserSessionViewportSchema.meta({
    id: "BrowserSessionSetViewportSizeParams",
  });

export const BrowserSessionCloseParamsSchema = z
  .object({})
  .strict()
  .meta({ id: "BrowserSessionCloseParams" });

export const BrowserSessionAddInitScriptRequestSchema =
  createBrowserSessionRequestSchema(
    "BrowserSessionAddInitScriptRequest",
    BrowserSessionAddInitScriptParamsSchema,
  );

export const BrowserSessionSetExtraHTTPHeadersRequestSchema =
  createBrowserSessionRequestSchema(
    "BrowserSessionSetExtraHTTPHeadersRequest",
    BrowserSessionSetExtraHTTPHeadersParamsSchema,
  );

export const BrowserSessionPagesRequestSchema =
  createBrowserSessionRequestSchema(
    "BrowserSessionPagesRequest",
    BrowserSessionPagesParamsSchema,
  );

export const BrowserSessionActivePageRequestSchema =
  createBrowserSessionRequestSchema(
    "BrowserSessionActivePageRequest",
    BrowserSessionActivePageParamsSchema,
  );

export const BrowserSessionAwaitActivePageRequestSchema =
  createBrowserSessionRequestSchema(
    "BrowserSessionAwaitActivePageRequest",
    BrowserSessionAwaitActivePageParamsSchema,
  );

export const BrowserSessionResolvePageByMainFrameIdRequestSchema =
  createBrowserSessionRequestSchema(
    "BrowserSessionResolvePageByMainFrameIdRequest",
    BrowserSessionResolvePageByMainFrameIdParamsSchema,
  );

export const BrowserSessionGetFullFrameTreeByMainFrameIdRequestSchema =
  createBrowserSessionRequestSchema(
    "BrowserSessionGetFullFrameTreeByMainFrameIdRequest",
    BrowserSessionGetFullFrameTreeByMainFrameIdParamsSchema,
  );

export const BrowserSessionNewPageRequestSchema =
  createBrowserSessionRequestSchema(
    "BrowserSessionNewPageRequest",
    BrowserSessionNewPageParamsSchema,
  );

export const BrowserSessionCookiesRequestSchema =
  createBrowserSessionRequestSchema(
    "BrowserSessionCookiesRequest",
    BrowserSessionCookiesParamsSchema,
  );

export const BrowserSessionAddCookiesRequestSchema =
  createBrowserSessionRequestSchema(
    "BrowserSessionAddCookiesRequest",
    BrowserSessionAddCookiesParamsSchema,
  );

export const BrowserSessionClearCookiesRequestSchema =
  createBrowserSessionRequestSchema(
    "BrowserSessionClearCookiesRequest",
    BrowserSessionClearCookiesParamsSchema,
  );

export const BrowserSessionConnectURLRequestSchema =
  createBrowserSessionRequestSchema(
    "BrowserSessionConnectURLRequest",
    BrowserSessionConnectURLParamsSchema,
  );

export const BrowserSessionConfiguredViewportRequestSchema =
  createBrowserSessionRequestSchema(
    "BrowserSessionConfiguredViewportRequest",
    BrowserSessionConfiguredViewportParamsSchema,
  );

export const BrowserSessionBrowserbaseSessionIDRequestSchema =
  createBrowserSessionRequestSchema(
    "BrowserSessionBrowserbaseSessionIDRequest",
    BrowserSessionBrowserbaseSessionIDParamsSchema,
  );

export const BrowserSessionBrowserbaseSessionURLRequestSchema =
  createBrowserSessionRequestSchema(
    "BrowserSessionBrowserbaseSessionURLRequest",
    BrowserSessionBrowserbaseSessionURLParamsSchema,
  );

export const BrowserSessionBrowserbaseDebugURLRequestSchema =
  createBrowserSessionRequestSchema(
    "BrowserSessionBrowserbaseDebugURLRequest",
    BrowserSessionBrowserbaseDebugURLParamsSchema,
  );

export const BrowserSessionIsBrowserbaseRequestSchema =
  createBrowserSessionRequestSchema(
    "BrowserSessionIsBrowserbaseRequest",
    BrowserSessionIsBrowserbaseParamsSchema,
  );

export const BrowserSessionIsAdvancedStealthRequestSchema =
  createBrowserSessionRequestSchema(
    "BrowserSessionIsAdvancedStealthRequest",
    BrowserSessionIsAdvancedStealthParamsSchema,
  );

export const BrowserSessionSetViewportSizeRequestSchema =
  createBrowserSessionRequestSchema(
    "BrowserSessionSetViewportSizeRequest",
    BrowserSessionSetViewportSizeParamsSchema,
  );

export const BrowserSessionCloseRequestSchema =
  createBrowserSessionRequestSchema(
    "BrowserSessionCloseRequest",
    BrowserSessionCloseParamsSchema,
  );

export const BrowserSessionAddInitScriptResultSchema = z
  .object({
    added: z.boolean(),
  })
  .strict()
  .meta({ id: "BrowserSessionAddInitScriptResult" });

export const BrowserSessionSetExtraHTTPHeadersResultSchema = z
  .object({
    headers: PageHeadersSchema,
  })
  .strict()
  .meta({ id: "BrowserSessionSetExtraHTTPHeadersResult" });

export const BrowserSessionPagesResultSchema = z
  .object({
    pages: z.array(BrowserSessionPageSchema),
  })
  .strict()
  .meta({ id: "BrowserSessionPagesResult" });

export const BrowserSessionOptionalPageResultSchema = z
  .object({
    page: BrowserSessionPageSchema.nullable(),
  })
  .strict()
  .meta({ id: "BrowserSessionOptionalPageResult" });

export const BrowserSessionPageResultSchema = z
  .object({
    page: BrowserSessionPageSchema,
  })
  .strict()
  .meta({ id: "BrowserSessionPageResult" });

export const BrowserSessionFrameTreeResultSchema = z
  .object({
    frameTree: z.unknown(),
  })
  .strict()
  .meta({ id: "BrowserSessionFrameTreeResult" });

export const BrowserSessionCookiesResultSchema = z
  .object({
    cookies: z.array(BrowserSessionCookieSchema),
  })
  .strict()
  .meta({ id: "BrowserSessionCookiesResult" });

export const BrowserSessionAddCookiesResultSchema = z
  .object({
    added: z.number().int().nonnegative(),
  })
  .strict()
  .meta({ id: "BrowserSessionAddCookiesResult" });

export const BrowserSessionClearCookiesResultSchema = z
  .object({
    cleared: z.boolean(),
  })
  .strict()
  .meta({ id: "BrowserSessionClearCookiesResult" });

export const BrowserSessionConnectURLResultSchema = z
  .object({
    connectURL: z.string(),
  })
  .strict()
  .meta({ id: "BrowserSessionConnectURLResult" });

export const BrowserSessionConfiguredViewportResultSchema =
  BrowserSessionViewportSchema.meta({
    id: "BrowserSessionConfiguredViewportResult",
  });

export const BrowserSessionBrowserbaseSessionIDResultSchema = z
  .object({
    browserbaseSessionID: z.string().nullable(),
  })
  .strict()
  .meta({ id: "BrowserSessionBrowserbaseSessionIDResult" });

export const BrowserSessionBrowserbaseSessionURLResultSchema = z
  .object({
    browserbaseSessionURL: z.string().nullable(),
  })
  .strict()
  .meta({ id: "BrowserSessionBrowserbaseSessionURLResult" });

export const BrowserSessionBrowserbaseDebugURLResultSchema = z
  .object({
    browserbaseDebugURL: z.string().nullable(),
  })
  .strict()
  .meta({ id: "BrowserSessionBrowserbaseDebugURLResult" });

export const BrowserSessionIsBrowserbaseResultSchema = z
  .object({
    isBrowserbase: z.boolean(),
  })
  .strict()
  .meta({ id: "BrowserSessionIsBrowserbaseResult" });

export const BrowserSessionIsAdvancedStealthResultSchema = z
  .object({
    isAdvancedStealth: z.boolean(),
  })
  .strict()
  .meta({ id: "BrowserSessionIsAdvancedStealthResult" });

export const BrowserSessionSetViewportSizeResultSchema =
  BrowserSessionViewportSchema.meta({
    id: "BrowserSessionSetViewportSizeResult",
  });

export const BrowserSessionCloseResultSchema = z
  .object({
    closed: z.boolean(),
  })
  .strict()
  .meta({ id: "BrowserSessionCloseResult" });

export const BrowserSessionAddInitScriptActionSchema =
  createBrowserSessionActionSchema(
    "BrowserSessionAddInitScriptAction",
    "addInitScript",
    BrowserSessionAddInitScriptParamsSchema,
    BrowserSessionAddInitScriptResultSchema,
  );

export const BrowserSessionSetExtraHTTPHeadersActionSchema =
  createBrowserSessionActionSchema(
    "BrowserSessionSetExtraHTTPHeadersAction",
    "setExtraHTTPHeaders",
    BrowserSessionSetExtraHTTPHeadersParamsSchema,
    BrowserSessionSetExtraHTTPHeadersResultSchema,
  );

export const BrowserSessionPagesActionSchema = createBrowserSessionActionSchema(
  "BrowserSessionPagesAction",
  "pages",
  BrowserSessionPagesParamsSchema,
  BrowserSessionPagesResultSchema,
);

export const BrowserSessionActivePageActionSchema =
  createBrowserSessionActionSchema(
    "BrowserSessionActivePageAction",
    "activePage",
    BrowserSessionActivePageParamsSchema,
    BrowserSessionOptionalPageResultSchema,
  );

export const BrowserSessionAwaitActivePageActionSchema =
  createBrowserSessionActionSchema(
    "BrowserSessionAwaitActivePageAction",
    "awaitActivePage",
    BrowserSessionAwaitActivePageParamsSchema,
    BrowserSessionPageResultSchema,
  );

export const BrowserSessionResolvePageByMainFrameIdActionSchema =
  createBrowserSessionActionSchema(
    "BrowserSessionResolvePageByMainFrameIdAction",
    "resolvePageByMainFrameId",
    BrowserSessionResolvePageByMainFrameIdParamsSchema,
    BrowserSessionOptionalPageResultSchema,
  );

export const BrowserSessionGetFullFrameTreeByMainFrameIdActionSchema =
  createBrowserSessionActionSchema(
    "BrowserSessionGetFullFrameTreeByMainFrameIdAction",
    "getFullFrameTreeByMainFrameId",
    BrowserSessionGetFullFrameTreeByMainFrameIdParamsSchema,
    BrowserSessionFrameTreeResultSchema,
  );

export const BrowserSessionNewPageActionSchema =
  createBrowserSessionActionSchema(
    "BrowserSessionNewPageAction",
    "newPage",
    BrowserSessionNewPageParamsSchema,
    BrowserSessionPageResultSchema,
  );

export const BrowserSessionCookiesActionSchema =
  createBrowserSessionActionSchema(
    "BrowserSessionCookiesAction",
    "cookies",
    BrowserSessionCookiesParamsSchema,
    BrowserSessionCookiesResultSchema,
  );

export const BrowserSessionAddCookiesActionSchema =
  createBrowserSessionActionSchema(
    "BrowserSessionAddCookiesAction",
    "addCookies",
    BrowserSessionAddCookiesParamsSchema,
    BrowserSessionAddCookiesResultSchema,
  );

export const BrowserSessionClearCookiesActionSchema =
  createBrowserSessionActionSchema(
    "BrowserSessionClearCookiesAction",
    "clearCookies",
    BrowserSessionClearCookiesParamsSchema,
    BrowserSessionClearCookiesResultSchema,
  );

export const BrowserSessionConnectURLActionSchema =
  createBrowserSessionActionSchema(
    "BrowserSessionConnectURLAction",
    "connectURL",
    BrowserSessionConnectURLParamsSchema,
    BrowserSessionConnectURLResultSchema,
  );

export const BrowserSessionConfiguredViewportActionSchema =
  createBrowserSessionActionSchema(
    "BrowserSessionConfiguredViewportAction",
    "configuredViewport",
    BrowserSessionConfiguredViewportParamsSchema,
    BrowserSessionConfiguredViewportResultSchema,
  );

export const BrowserSessionBrowserbaseSessionIDActionSchema =
  createBrowserSessionActionSchema(
    "BrowserSessionBrowserbaseSessionIDAction",
    "browserbaseSessionID",
    BrowserSessionBrowserbaseSessionIDParamsSchema,
    BrowserSessionBrowserbaseSessionIDResultSchema,
  );

export const BrowserSessionBrowserbaseSessionURLActionSchema =
  createBrowserSessionActionSchema(
    "BrowserSessionBrowserbaseSessionURLAction",
    "browserbaseSessionURL",
    BrowserSessionBrowserbaseSessionURLParamsSchema,
    BrowserSessionBrowserbaseSessionURLResultSchema,
  );

export const BrowserSessionBrowserbaseDebugURLActionSchema =
  createBrowserSessionActionSchema(
    "BrowserSessionBrowserbaseDebugURLAction",
    "browserbaseDebugURL",
    BrowserSessionBrowserbaseDebugURLParamsSchema,
    BrowserSessionBrowserbaseDebugURLResultSchema,
  );

export const BrowserSessionIsBrowserbaseActionSchema =
  createBrowserSessionActionSchema(
    "BrowserSessionIsBrowserbaseAction",
    "isBrowserbase",
    BrowserSessionIsBrowserbaseParamsSchema,
    BrowserSessionIsBrowserbaseResultSchema,
  );

export const BrowserSessionIsAdvancedStealthActionSchema =
  createBrowserSessionActionSchema(
    "BrowserSessionIsAdvancedStealthAction",
    "isAdvancedStealth",
    BrowserSessionIsAdvancedStealthParamsSchema,
    BrowserSessionIsAdvancedStealthResultSchema,
  );

export const BrowserSessionSetViewportSizeActionSchema =
  createBrowserSessionActionSchema(
    "BrowserSessionSetViewportSizeAction",
    "setViewportSize",
    BrowserSessionSetViewportSizeParamsSchema,
    BrowserSessionSetViewportSizeResultSchema,
  );

export const BrowserSessionCloseActionSchema = createBrowserSessionActionSchema(
  "BrowserSessionCloseAction",
  "close",
  BrowserSessionCloseParamsSchema,
  BrowserSessionCloseResultSchema,
);

export const BrowserSessionActionSchema = z
  .union([
    BrowserSessionAddInitScriptActionSchema,
    BrowserSessionSetExtraHTTPHeadersActionSchema,
    BrowserSessionPagesActionSchema,
    BrowserSessionActivePageActionSchema,
    BrowserSessionAwaitActivePageActionSchema,
    BrowserSessionResolvePageByMainFrameIdActionSchema,
    BrowserSessionGetFullFrameTreeByMainFrameIdActionSchema,
    BrowserSessionNewPageActionSchema,
    BrowserSessionCookiesActionSchema,
    BrowserSessionAddCookiesActionSchema,
    BrowserSessionClearCookiesActionSchema,
    BrowserSessionConnectURLActionSchema,
    BrowserSessionConfiguredViewportActionSchema,
    BrowserSessionBrowserbaseSessionIDActionSchema,
    BrowserSessionBrowserbaseSessionURLActionSchema,
    BrowserSessionBrowserbaseDebugURLActionSchema,
    BrowserSessionIsBrowserbaseActionSchema,
    BrowserSessionIsAdvancedStealthActionSchema,
    BrowserSessionSetViewportSizeActionSchema,
    BrowserSessionCloseActionSchema,
  ])
  .meta({ id: "BrowserSessionAction" });

export const BrowserSessionV4ErrorResponseSchema = z
  .object({
    success: z.literal(false),
    error: z.string(),
    statusCode: z.number().int(),
    stack: z.string().nullable(),
    action: BrowserSessionActionSchema.optional(),
  })
  .strict()
  .meta({ id: "BrowserSessionV4ErrorResponse" });

export const BrowserSessionAddInitScriptResponseSchema =
  createBrowserSessionResponseSchema(
    "BrowserSessionAddInitScriptResponse",
    BrowserSessionAddInitScriptActionSchema,
  );

export const BrowserSessionSetExtraHTTPHeadersResponseSchema =
  createBrowserSessionResponseSchema(
    "BrowserSessionSetExtraHTTPHeadersResponse",
    BrowserSessionSetExtraHTTPHeadersActionSchema,
  );

export const BrowserSessionPagesResponseSchema =
  createBrowserSessionResponseSchema(
    "BrowserSessionPagesResponse",
    BrowserSessionPagesActionSchema,
  );

export const BrowserSessionActivePageResponseSchema =
  createBrowserSessionResponseSchema(
    "BrowserSessionActivePageResponse",
    BrowserSessionActivePageActionSchema,
  );

export const BrowserSessionAwaitActivePageResponseSchema =
  createBrowserSessionResponseSchema(
    "BrowserSessionAwaitActivePageResponse",
    BrowserSessionAwaitActivePageActionSchema,
  );

export const BrowserSessionResolvePageByMainFrameIdResponseSchema =
  createBrowserSessionResponseSchema(
    "BrowserSessionResolvePageByMainFrameIdResponse",
    BrowserSessionResolvePageByMainFrameIdActionSchema,
  );

export const BrowserSessionGetFullFrameTreeByMainFrameIdResponseSchema =
  createBrowserSessionResponseSchema(
    "BrowserSessionGetFullFrameTreeByMainFrameIdResponse",
    BrowserSessionGetFullFrameTreeByMainFrameIdActionSchema,
  );

export const BrowserSessionNewPageResponseSchema =
  createBrowserSessionResponseSchema(
    "BrowserSessionNewPageResponse",
    BrowserSessionNewPageActionSchema,
  );

export const BrowserSessionCookiesResponseSchema =
  createBrowserSessionResponseSchema(
    "BrowserSessionCookiesResponse",
    BrowserSessionCookiesActionSchema,
  );

export const BrowserSessionAddCookiesResponseSchema =
  createBrowserSessionResponseSchema(
    "BrowserSessionAddCookiesResponse",
    BrowserSessionAddCookiesActionSchema,
  );

export const BrowserSessionClearCookiesResponseSchema =
  createBrowserSessionResponseSchema(
    "BrowserSessionClearCookiesResponse",
    BrowserSessionClearCookiesActionSchema,
  );

export const BrowserSessionConnectURLResponseSchema =
  createBrowserSessionResponseSchema(
    "BrowserSessionConnectURLResponse",
    BrowserSessionConnectURLActionSchema,
  );

export const BrowserSessionConfiguredViewportResponseSchema =
  createBrowserSessionResponseSchema(
    "BrowserSessionConfiguredViewportResponse",
    BrowserSessionConfiguredViewportActionSchema,
  );

export const BrowserSessionBrowserbaseSessionIDResponseSchema =
  createBrowserSessionResponseSchema(
    "BrowserSessionBrowserbaseSessionIDResponse",
    BrowserSessionBrowserbaseSessionIDActionSchema,
  );

export const BrowserSessionBrowserbaseSessionURLResponseSchema =
  createBrowserSessionResponseSchema(
    "BrowserSessionBrowserbaseSessionURLResponse",
    BrowserSessionBrowserbaseSessionURLActionSchema,
  );

export const BrowserSessionBrowserbaseDebugURLResponseSchema =
  createBrowserSessionResponseSchema(
    "BrowserSessionBrowserbaseDebugURLResponse",
    BrowserSessionBrowserbaseDebugURLActionSchema,
  );

export const BrowserSessionIsBrowserbaseResponseSchema =
  createBrowserSessionResponseSchema(
    "BrowserSessionIsBrowserbaseResponse",
    BrowserSessionIsBrowserbaseActionSchema,
  );

export const BrowserSessionIsAdvancedStealthResponseSchema =
  createBrowserSessionResponseSchema(
    "BrowserSessionIsAdvancedStealthResponse",
    BrowserSessionIsAdvancedStealthActionSchema,
  );

export const BrowserSessionSetViewportSizeResponseSchema =
  createBrowserSessionResponseSchema(
    "BrowserSessionSetViewportSizeResponse",
    BrowserSessionSetViewportSizeActionSchema,
  );

export const BrowserSessionCloseResponseSchema =
  createBrowserSessionResponseSchema(
    "BrowserSessionCloseResponse",
    BrowserSessionCloseActionSchema,
  );

export const BrowserSessionActionIdParamsSchema = z
  .object({
    actionId: ActionIdSchema,
  })
  .strict()
  .meta({ id: "BrowserSessionActionIdParams" });

export const BrowserSessionActionDetailsQuerySchema = z
  .object({
    id: RequestIdSchema.optional(),
    sessionId: BrowserSessionIdSchema,
  })
  .strict()
  .meta({ id: "BrowserSessionActionDetailsQuery" });

export const BrowserSessionActionListQuerySchema = z
  .object({
    id: RequestIdSchema.optional(),
    sessionId: BrowserSessionIdSchema,
    pageId: PageIdSchema.optional(),
    method: BrowserSessionActionMethodSchema.optional(),
    status: BrowserSessionActionStatusSchema.optional(),
    limit: z.coerce.number().int().positive().max(500).optional(),
  })
  .strict()
  .meta({ id: "BrowserSessionActionListQuery" });

export const BrowserSessionActionDetailsResponseSchema = z
  .object({
    success: z.literal(true),
    error: z.null(),
    action: BrowserSessionActionSchema,
  })
  .strict()
  .meta({ id: "BrowserSessionActionDetailsResponse" });

export const BrowserSessionActionListResponseSchema = z
  .object({
    success: z.literal(true),
    error: z.null(),
    actions: z.array(BrowserSessionActionSchema),
  })
  .strict()
  .meta({ id: "BrowserSessionActionListResponse" });

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
    BrowserSessionActionMethod: BrowserSessionActionMethodSchema,
    BrowserSessionActionStatus: BrowserSessionActionStatusSchema,
    BrowserSessionPage: BrowserSessionPageSchema,
    BrowserSessionCookie: BrowserSessionCookieSchema,
    BrowserSessionCookieParam: BrowserSessionCookieParamSchema,
    BrowserSessionRegex: BrowserSessionRegexSchema,
    BrowserSessionStringPattern: BrowserSessionStringPatternSchema,
    BrowserSessionClearCookiesOptions: BrowserSessionClearCookiesOptionsSchema,
    BrowserSessionViewport: BrowserSessionViewportSchema,
    BrowserSessionActionBase: BrowserSessionActionBaseSchema,
    BrowserSessionAddInitScriptParams: BrowserSessionAddInitScriptParamsSchema,
    BrowserSessionSetExtraHTTPHeadersParams:
      BrowserSessionSetExtraHTTPHeadersParamsSchema,
    BrowserSessionPagesParams: BrowserSessionPagesParamsSchema,
    BrowserSessionActivePageParams: BrowserSessionActivePageParamsSchema,
    BrowserSessionAwaitActivePageParams:
      BrowserSessionAwaitActivePageParamsSchema,
    BrowserSessionResolvePageByMainFrameIdParams:
      BrowserSessionResolvePageByMainFrameIdParamsSchema,
    BrowserSessionGetFullFrameTreeByMainFrameIdParams:
      BrowserSessionGetFullFrameTreeByMainFrameIdParamsSchema,
    BrowserSessionNewPageParams: BrowserSessionNewPageParamsSchema,
    BrowserSessionCookiesParams: BrowserSessionCookiesParamsSchema,
    BrowserSessionAddCookiesParams: BrowserSessionAddCookiesParamsSchema,
    BrowserSessionClearCookiesParams: BrowserSessionClearCookiesParamsSchema,
    BrowserSessionConnectURLParams: BrowserSessionConnectURLParamsSchema,
    BrowserSessionConfiguredViewportParams:
      BrowserSessionConfiguredViewportParamsSchema,
    BrowserSessionBrowserbaseSessionIDParams:
      BrowserSessionBrowserbaseSessionIDParamsSchema,
    BrowserSessionBrowserbaseSessionURLParams:
      BrowserSessionBrowserbaseSessionURLParamsSchema,
    BrowserSessionBrowserbaseDebugURLParams:
      BrowserSessionBrowserbaseDebugURLParamsSchema,
    BrowserSessionIsBrowserbaseParams: BrowserSessionIsBrowserbaseParamsSchema,
    BrowserSessionIsAdvancedStealthParams:
      BrowserSessionIsAdvancedStealthParamsSchema,
    BrowserSessionSetViewportSizeParams:
      BrowserSessionSetViewportSizeParamsSchema,
    BrowserSessionCloseParams: BrowserSessionCloseParamsSchema,
    BrowserSessionAddInitScriptRequest:
      BrowserSessionAddInitScriptRequestSchema,
    BrowserSessionSetExtraHTTPHeadersRequest:
      BrowserSessionSetExtraHTTPHeadersRequestSchema,
    BrowserSessionPagesRequest: BrowserSessionPagesRequestSchema,
    BrowserSessionActivePageRequest: BrowserSessionActivePageRequestSchema,
    BrowserSessionAwaitActivePageRequest:
      BrowserSessionAwaitActivePageRequestSchema,
    BrowserSessionResolvePageByMainFrameIdRequest:
      BrowserSessionResolvePageByMainFrameIdRequestSchema,
    BrowserSessionGetFullFrameTreeByMainFrameIdRequest:
      BrowserSessionGetFullFrameTreeByMainFrameIdRequestSchema,
    BrowserSessionNewPageRequest: BrowserSessionNewPageRequestSchema,
    BrowserSessionCookiesRequest: BrowserSessionCookiesRequestSchema,
    BrowserSessionAddCookiesRequest: BrowserSessionAddCookiesRequestSchema,
    BrowserSessionClearCookiesRequest: BrowserSessionClearCookiesRequestSchema,
    BrowserSessionConnectURLRequest: BrowserSessionConnectURLRequestSchema,
    BrowserSessionConfiguredViewportRequest:
      BrowserSessionConfiguredViewportRequestSchema,
    BrowserSessionBrowserbaseSessionIDRequest:
      BrowserSessionBrowserbaseSessionIDRequestSchema,
    BrowserSessionBrowserbaseSessionURLRequest:
      BrowserSessionBrowserbaseSessionURLRequestSchema,
    BrowserSessionBrowserbaseDebugURLRequest:
      BrowserSessionBrowserbaseDebugURLRequestSchema,
    BrowserSessionIsBrowserbaseRequest:
      BrowserSessionIsBrowserbaseRequestSchema,
    BrowserSessionIsAdvancedStealthRequest:
      BrowserSessionIsAdvancedStealthRequestSchema,
    BrowserSessionSetViewportSizeRequest:
      BrowserSessionSetViewportSizeRequestSchema,
    BrowserSessionCloseRequest: BrowserSessionCloseRequestSchema,
    BrowserSessionAddInitScriptAction: BrowserSessionAddInitScriptActionSchema,
    BrowserSessionSetExtraHTTPHeadersAction:
      BrowserSessionSetExtraHTTPHeadersActionSchema,
    BrowserSessionPagesAction: BrowserSessionPagesActionSchema,
    BrowserSessionActivePageAction: BrowserSessionActivePageActionSchema,
    BrowserSessionAwaitActivePageAction:
      BrowserSessionAwaitActivePageActionSchema,
    BrowserSessionResolvePageByMainFrameIdAction:
      BrowserSessionResolvePageByMainFrameIdActionSchema,
    BrowserSessionGetFullFrameTreeByMainFrameIdAction:
      BrowserSessionGetFullFrameTreeByMainFrameIdActionSchema,
    BrowserSessionNewPageAction: BrowserSessionNewPageActionSchema,
    BrowserSessionCookiesAction: BrowserSessionCookiesActionSchema,
    BrowserSessionAddCookiesAction: BrowserSessionAddCookiesActionSchema,
    BrowserSessionClearCookiesAction: BrowserSessionClearCookiesActionSchema,
    BrowserSessionConnectURLAction: BrowserSessionConnectURLActionSchema,
    BrowserSessionConfiguredViewportAction:
      BrowserSessionConfiguredViewportActionSchema,
    BrowserSessionBrowserbaseSessionIDAction:
      BrowserSessionBrowserbaseSessionIDActionSchema,
    BrowserSessionBrowserbaseSessionURLAction:
      BrowserSessionBrowserbaseSessionURLActionSchema,
    BrowserSessionBrowserbaseDebugURLAction:
      BrowserSessionBrowserbaseDebugURLActionSchema,
    BrowserSessionIsBrowserbaseAction: BrowserSessionIsBrowserbaseActionSchema,
    BrowserSessionIsAdvancedStealthAction:
      BrowserSessionIsAdvancedStealthActionSchema,
    BrowserSessionSetViewportSizeAction:
      BrowserSessionSetViewportSizeActionSchema,
    BrowserSessionCloseAction: BrowserSessionCloseActionSchema,
    BrowserSessionAction: BrowserSessionActionSchema,
    BrowserSessionV4ErrorResponse: BrowserSessionV4ErrorResponseSchema,
    BrowserSessionAddInitScriptResponse:
      BrowserSessionAddInitScriptResponseSchema,
    BrowserSessionSetExtraHTTPHeadersResponse:
      BrowserSessionSetExtraHTTPHeadersResponseSchema,
    BrowserSessionPagesResponse: BrowserSessionPagesResponseSchema,
    BrowserSessionActivePageResponse: BrowserSessionActivePageResponseSchema,
    BrowserSessionAwaitActivePageResponse:
      BrowserSessionAwaitActivePageResponseSchema,
    BrowserSessionResolvePageByMainFrameIdResponse:
      BrowserSessionResolvePageByMainFrameIdResponseSchema,
    BrowserSessionGetFullFrameTreeByMainFrameIdResponse:
      BrowserSessionGetFullFrameTreeByMainFrameIdResponseSchema,
    BrowserSessionNewPageResponse: BrowserSessionNewPageResponseSchema,
    BrowserSessionCookiesResponse: BrowserSessionCookiesResponseSchema,
    BrowserSessionAddCookiesResponse: BrowserSessionAddCookiesResponseSchema,
    BrowserSessionClearCookiesResponse:
      BrowserSessionClearCookiesResponseSchema,
    BrowserSessionConnectURLResponse: BrowserSessionConnectURLResponseSchema,
    BrowserSessionConfiguredViewportResponse:
      BrowserSessionConfiguredViewportResponseSchema,
    BrowserSessionBrowserbaseSessionIDResponse:
      BrowserSessionBrowserbaseSessionIDResponseSchema,
    BrowserSessionBrowserbaseSessionURLResponse:
      BrowserSessionBrowserbaseSessionURLResponseSchema,
    BrowserSessionBrowserbaseDebugURLResponse:
      BrowserSessionBrowserbaseDebugURLResponseSchema,
    BrowserSessionIsBrowserbaseResponse:
      BrowserSessionIsBrowserbaseResponseSchema,
    BrowserSessionIsAdvancedStealthResponse:
      BrowserSessionIsAdvancedStealthResponseSchema,
    BrowserSessionSetViewportSizeResponse:
      BrowserSessionSetViewportSizeResponseSchema,
    BrowserSessionCloseResponse: BrowserSessionCloseResponseSchema,
    BrowserSessionActionIdParams: BrowserSessionActionIdParamsSchema,
    BrowserSessionActionDetailsQuery: BrowserSessionActionDetailsQuerySchema,
    BrowserSessionActionListQuery: BrowserSessionActionListQuerySchema,
    BrowserSessionActionDetailsResponse:
      BrowserSessionActionDetailsResponseSchema,
    BrowserSessionActionListResponse: BrowserSessionActionListResponseSchema,
  },
};

export type BrowserSessionCreateRequest = z.infer<
  typeof BrowserSessionCreateRequestSchema
>;
export type BrowserSessionIdParams = z.infer<
  typeof BrowserSessionIdParamsSchema
>;
export type BrowserSession = z.infer<typeof BrowserSessionSchema>;
export type BrowserSessionActionMethod = z.infer<
  typeof BrowserSessionActionMethodSchema
>;
export type BrowserSessionAction = z.infer<typeof BrowserSessionActionSchema>;
export type BrowserSessionActionDetailsQuery = z.infer<
  typeof BrowserSessionActionDetailsQuerySchema
>;
export type BrowserSessionActionListQuery = z.infer<
  typeof BrowserSessionActionListQuerySchema
>;
export type BrowserSessionPage = z.infer<typeof BrowserSessionPageSchema>;

export function buildBrowserSessionErrorResponse(input: {
  error: string;
  statusCode: number;
  stack?: string | null;
  action?: z.input<typeof BrowserSessionActionSchema>;
}) {
  return BrowserSessionV4ErrorResponseSchema.parse({
    success: false,
    error: input.error,
    statusCode: input.statusCode,
    stack: input.stack ?? null,
    ...(input.action ? { action: input.action } : {}),
  });
}
