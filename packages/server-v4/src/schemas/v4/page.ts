import { z } from "zod/v4";

export const RequestIdSchema = z
  .string()
  .min(1)
  .meta({ id: "RequestId", example: "req_01JXAMPLE" });

export const SessionIdSchema = z
  .string()
  .min(1)
  .meta({ id: "SessionId", example: "session_01JXAMPLE" });

export const PageIdSchema = z
  .string()
  .min(1)
  .meta({ id: "PageId", example: "target_01JXAMPLE" });

export const ActionIdSchema = z
  .string()
  .min(1)
  .meta({ id: "ActionId", example: "action_01JXAMPLE" });

export const TimestampSchema = z
  .string()
  .datetime()
  .meta({ id: "Timestamp", example: "2026-02-03T12:00:00.000Z" });

export const MouseButtonSchema = z
  .enum(["left", "right", "middle"])
  .meta({ id: "MouseButton" });

export const LoadStateSchema = z
  .enum(["load", "domcontentloaded", "networkidle"])
  .meta({ id: "LoadState" });

export const WaitForSelectorStateSchema = z
  .enum(["attached", "detached", "visible", "hidden"])
  .meta({ id: "WaitForSelectorState" });

export const ScreenshotTypeSchema = z
  .enum(["png", "jpeg"])
  .meta({ id: "ScreenshotType" });

export const ScreenshotMimeTypeSchema = z
  .enum(["image/png", "image/jpeg"])
  .meta({ id: "ScreenshotMimeType" });

export const ScreenshotScaleSchema = z
  .enum(["css", "device"])
  .meta({ id: "ScreenshotScale" });

export const ScreenshotAnimationsSchema = z
  .enum(["allow", "disabled"])
  .meta({ id: "ScreenshotAnimations" });

export const ScreenshotCaretSchema = z
  .enum(["hide", "initial"])
  .meta({ id: "ScreenshotCaret" });

export const PageActionMethodSchema = z
  .enum([
    "click",
    "hover",
    "scroll",
    "dragAndDrop",
    "type",
    "keyPress",
    "goto",
    "reload",
    "goBack",
    "goForward",
    "title",
    "url",
    "screenshot",
    "snapshot",
    "setViewportSize",
    "waitForLoadState",
    "waitForSelector",
    "waitForTimeout",
    "evaluate",
    "sendCDP",
    "close",
  ])
  .meta({ id: "PageActionMethod" });

export const PageActionStatusSchema = z
  .enum(["queued", "running", "completed", "failed", "canceled"])
  .meta({ id: "PageActionStatus" });

export const PageSelectorSchema = z
  .object({
    xpath: z.string().min(1).meta({
      example: "//button[text()='Submit']",
    }),
  })
  .strict()
  .meta({ id: "PageSelector" });

export const PagePointSchema = z
  .object({
    x: z.number(),
    y: z.number(),
  })
  .strict()
  .meta({ id: "PagePoint" });

export const PageClipSchema = z
  .object({
    x: z.number(),
    y: z.number(),
    width: z.number().positive(),
    height: z.number().positive(),
  })
  .strict()
  .meta({ id: "PageClip" });

export const PageMetadataSchema = z
  .object({
    requestId: z.string().min(1),
    sessionId: SessionIdSchema.optional(),
    pageId: PageIdSchema.optional(),
    actionId: ActionIdSchema.optional(),
    timestamp: TimestampSchema,
  })
  .strict()
  .meta({ id: "PageMetadata" });

export const PageErrorSchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
  .meta({ id: "PageError" });

export const ValidationErrorResponseSchema = z
  .object({
    error: z.string(),
    issues: z.array(z.unknown()).optional(),
    statusCode: z.number().optional(),
    code: z.string().optional(),
    message: z.string().optional(),
  })
  .passthrough()
  .meta({ id: "ValidationErrorResponse" });

export const V4ErrorResponseSchema = z
  .object({
    id: RequestIdSchema,
    error: PageErrorSchema,
    result: z.null(),
    metadata: PageMetadataSchema,
  })
  .strict()
  .meta({ id: "V4ErrorResponse" });

const PageBodySchema = z
  .object({
    id: RequestIdSchema.optional(),
    sessionId: SessionIdSchema,
  })
  .strict();

const PageWithPageIdSchema = z
  .object({
    pageId: PageIdSchema.optional(),
  })
  .strict();

const PageActionBaseSchema = z
  .object({
    id: ActionIdSchema,
    method: PageActionMethodSchema,
    status: PageActionStatusSchema,
    sessionId: SessionIdSchema,
    pageId: PageIdSchema.optional(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    completedAt: TimestampSchema.optional(),
    error: PageErrorSchema.nullable(),
  })
  .strict()
  .meta({ id: "PageActionBase" });

function createPageRequestSchema<T extends z.ZodTypeAny>(
  id: string,
  params: T,
) {
  return PageBodySchema.extend({ params }).meta({ id });
}

function createPageActionSchema<
  TMethod extends PageActionMethod,
  TParams extends z.ZodTypeAny,
  TResult extends z.ZodTypeAny,
>(id: string, method: TMethod, params: TParams, result: TResult) {
  return PageActionBaseSchema.extend({
    method: z.literal(method),
    params,
    result: result.nullable(),
  }).meta({ id });
}

function createPageResponseSchema<T extends z.ZodTypeAny>(
  id: string,
  action: T,
) {
  return z
    .object({
      id: RequestIdSchema,
      error: z.null(),
      result: z
        .object({
          action,
        })
        .strict(),
      metadata: PageMetadataSchema,
    })
    .strict()
    .meta({ id });
}

const PageClickSelectorParamsSchema = PageWithPageIdSchema.extend({
  selector: PageSelectorSchema,
  button: MouseButtonSchema.optional(),
  clickCount: z.number().int().min(1).max(3).optional(),
})
  .strict()
  .meta({ id: "PageClickSelectorParams" });

const PageClickCoordinatesParamsSchema = PageWithPageIdSchema.extend({
  x: z.number(),
  y: z.number(),
  button: MouseButtonSchema.optional(),
  clickCount: z.number().int().min(1).max(3).optional(),
})
  .strict()
  .meta({ id: "PageClickCoordinatesParams" });

export const PageClickParamsSchema = z
  .union([PageClickSelectorParamsSchema, PageClickCoordinatesParamsSchema])
  .meta({ id: "PageClickParams" });

const PageHoverSelectorParamsSchema = PageWithPageIdSchema.extend({
  selector: PageSelectorSchema,
})
  .strict()
  .meta({ id: "PageHoverSelectorParams" });

const PageHoverCoordinatesParamsSchema = PageWithPageIdSchema.extend({
  x: z.number(),
  y: z.number(),
})
  .strict()
  .meta({ id: "PageHoverCoordinatesParams" });

export const PageHoverParamsSchema = z
  .union([PageHoverSelectorParamsSchema, PageHoverCoordinatesParamsSchema])
  .meta({ id: "PageHoverParams" });

const PageScrollSelectorParamsSchema = PageWithPageIdSchema.extend({
  selector: PageSelectorSchema,
  percentage: z.number().min(0).max(100),
})
  .strict()
  .meta({ id: "PageScrollSelectorParams" });

const PageScrollCoordinatesParamsSchema = PageWithPageIdSchema.extend({
  x: z.number(),
  y: z.number(),
  deltaX: z.number().optional(),
  deltaY: z.number(),
})
  .strict()
  .meta({ id: "PageScrollCoordinatesParams" });

export const PageScrollParamsSchema = z
  .union([PageScrollSelectorParamsSchema, PageScrollCoordinatesParamsSchema])
  .meta({ id: "PageScrollParams" });

const PageDragAndDropSelectorParamsSchema = PageWithPageIdSchema.extend({
  from: PageSelectorSchema,
  to: PageSelectorSchema,
  button: MouseButtonSchema.optional(),
  steps: z.number().int().positive().optional(),
  delay: z.number().int().min(0).optional(),
})
  .strict()
  .meta({ id: "PageDragAndDropSelectorParams" });

const PageDragAndDropCoordinatesParamsSchema = PageWithPageIdSchema.extend({
  from: PagePointSchema,
  to: PagePointSchema,
  button: MouseButtonSchema.optional(),
  steps: z.number().int().positive().optional(),
  delay: z.number().int().min(0).optional(),
})
  .strict()
  .meta({ id: "PageDragAndDropCoordinatesParams" });

export const PageDragAndDropParamsSchema = z
  .union([
    PageDragAndDropSelectorParamsSchema,
    PageDragAndDropCoordinatesParamsSchema,
  ])
  .meta({ id: "PageDragAndDropParams" });

export const PageTypeParamsSchema = PageWithPageIdSchema.extend({
  text: z.string(),
  delay: z.number().int().min(0).optional(),
  withMistakes: z.boolean().optional(),
})
  .strict()
  .meta({ id: "PageTypeParams" });

export const PageKeyPressParamsSchema = PageWithPageIdSchema.extend({
  key: z.string().min(1),
  delay: z.number().int().min(0).optional(),
})
  .strict()
  .meta({ id: "PageKeyPressParams" });

export const PageGotoParamsSchema = PageWithPageIdSchema.extend({
  url: z.string().url(),
  waitUntil: LoadStateSchema.optional(),
  timeoutMs: z.number().int().positive().optional(),
})
  .strict()
  .meta({ id: "PageGotoParams" });

export const PageReloadParamsSchema = PageWithPageIdSchema.extend({
  waitUntil: LoadStateSchema.optional(),
  timeoutMs: z.number().int().positive().optional(),
  ignoreCache: z.boolean().optional(),
})
  .strict()
  .meta({ id: "PageReloadParams" });

export const PageGoBackParamsSchema = PageWithPageIdSchema.extend({
  waitUntil: LoadStateSchema.optional(),
  timeoutMs: z.number().int().positive().optional(),
})
  .strict()
  .meta({ id: "PageGoBackParams" });

export const PageGoForwardParamsSchema = PageWithPageIdSchema.extend({
  waitUntil: LoadStateSchema.optional(),
  timeoutMs: z.number().int().positive().optional(),
})
  .strict()
  .meta({ id: "PageGoForwardParams" });

export const PageTitleParamsSchema = PageWithPageIdSchema.meta({
  id: "PageTitleParams",
});

export const PageUrlParamsSchema = PageWithPageIdSchema.meta({
  id: "PageUrlParams",
});

export const PageScreenshotParamsSchema = PageWithPageIdSchema.extend({
  fullPage: z.boolean().optional(),
  clip: PageClipSchema.optional(),
  type: ScreenshotTypeSchema.optional(),
  quality: z.number().int().min(0).max(100).optional(),
  scale: ScreenshotScaleSchema.optional(),
  animations: ScreenshotAnimationsSchema.optional(),
  caret: ScreenshotCaretSchema.optional(),
  style: z.string().optional(),
  omitBackground: z.boolean().optional(),
  timeout: z.number().int().positive().optional(),
})
  .strict()
  .superRefine((value, ctx) => {
    if (value.quality !== undefined && value.type !== "jpeg") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["quality"],
        message: "quality is only supported when type is 'jpeg'",
      });
    }

    if (value.clip && value.fullPage) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["clip"],
        message: "clip cannot be used together with fullPage",
      });
    }
  })
  .meta({ id: "PageScreenshotParams" });

export const PageSnapshotParamsSchema = PageWithPageIdSchema.extend({
  includeIframes: z.boolean().optional(),
})
  .strict()
  .meta({ id: "PageSnapshotParams" });

export const PageSetViewportSizeParamsSchema = PageWithPageIdSchema.extend({
  width: z.number().positive(),
  height: z.number().positive(),
  deviceScaleFactor: z.number().positive().optional(),
})
  .strict()
  .meta({ id: "PageSetViewportSizeParams" });

export const PageWaitForLoadStateParamsSchema = PageWithPageIdSchema.extend({
  state: LoadStateSchema,
  timeoutMs: z.number().int().positive().optional(),
})
  .strict()
  .meta({ id: "PageWaitForLoadStateParams" });

export const PageWaitForSelectorParamsSchema = PageWithPageIdSchema.extend({
  selector: PageSelectorSchema,
  state: WaitForSelectorStateSchema.optional(),
  timeout: z.number().int().positive().optional(),
  pierceShadow: z.boolean().optional(),
})
  .strict()
  .meta({ id: "PageWaitForSelectorParams" });

export const PageWaitForTimeoutParamsSchema = PageWithPageIdSchema.extend({
  ms: z.number().int().positive(),
})
  .strict()
  .meta({ id: "PageWaitForTimeoutParams" });

export const PageEvaluateParamsSchema = PageWithPageIdSchema.extend({
  expression: z.string().min(1),
  arg: z.unknown().optional(),
})
  .strict()
  .meta({ id: "PageEvaluateParams" });

export const PageSendCDPParamsSchema = PageWithPageIdSchema.extend({
  method: z.string().min(1),
  params: z.unknown().optional(),
})
  .strict()
  .meta({ id: "PageSendCDPParams" });

export const PageCloseParamsSchema = PageWithPageIdSchema.meta({
  id: "PageCloseParams",
});

export const PageClickRequestSchema = createPageRequestSchema(
  "PageClickRequest",
  PageClickParamsSchema,
);

export const PageHoverRequestSchema = createPageRequestSchema(
  "PageHoverRequest",
  PageHoverParamsSchema,
);

export const PageScrollRequestSchema = createPageRequestSchema(
  "PageScrollRequest",
  PageScrollParamsSchema,
);

export const PageDragAndDropRequestSchema = createPageRequestSchema(
  "PageDragAndDropRequest",
  PageDragAndDropParamsSchema,
);

export const PageTypeRequestSchema = createPageRequestSchema(
  "PageTypeRequest",
  PageTypeParamsSchema,
);

export const PageKeyPressRequestSchema = createPageRequestSchema(
  "PageKeyPressRequest",
  PageKeyPressParamsSchema,
);

export const PageGotoRequestSchema = createPageRequestSchema(
  "PageGotoRequest",
  PageGotoParamsSchema,
);

export const PageReloadRequestSchema = createPageRequestSchema(
  "PageReloadRequest",
  PageReloadParamsSchema,
);

export const PageGoBackRequestSchema = createPageRequestSchema(
  "PageGoBackRequest",
  PageGoBackParamsSchema,
);

export const PageGoForwardRequestSchema = createPageRequestSchema(
  "PageGoForwardRequest",
  PageGoForwardParamsSchema,
);

export const PageTitleRequestSchema = createPageRequestSchema(
  "PageTitleRequest",
  PageTitleParamsSchema,
);

export const PageUrlRequestSchema = createPageRequestSchema(
  "PageUrlRequest",
  PageUrlParamsSchema,
);

export const PageScreenshotRequestSchema = createPageRequestSchema(
  "PageScreenshotRequest",
  PageScreenshotParamsSchema,
);

export const PageSnapshotRequestSchema = createPageRequestSchema(
  "PageSnapshotRequest",
  PageSnapshotParamsSchema,
);

export const PageSetViewportSizeRequestSchema = createPageRequestSchema(
  "PageSetViewportSizeRequest",
  PageSetViewportSizeParamsSchema,
);

export const PageWaitForLoadStateRequestSchema = createPageRequestSchema(
  "PageWaitForLoadStateRequest",
  PageWaitForLoadStateParamsSchema,
);

export const PageWaitForSelectorRequestSchema = createPageRequestSchema(
  "PageWaitForSelectorRequest",
  PageWaitForSelectorParamsSchema,
);

export const PageWaitForTimeoutRequestSchema = createPageRequestSchema(
  "PageWaitForTimeoutRequest",
  PageWaitForTimeoutParamsSchema,
);

export const PageEvaluateRequestSchema = createPageRequestSchema(
  "PageEvaluateRequest",
  PageEvaluateParamsSchema,
);

export const PageSendCDPRequestSchema = createPageRequestSchema(
  "PageSendCDPRequest",
  PageSendCDPParamsSchema,
);

export const PageCloseRequestSchema = createPageRequestSchema(
  "PageCloseRequest",
  PageCloseParamsSchema,
);

const PageXPathResultSchema = z
  .object({
    xpath: z.string().optional(),
  })
  .strict()
  .meta({ id: "PageXPathResult" });

const PageDragAndDropResultSchema = z
  .object({
    fromXpath: z.string().optional(),
    toXpath: z.string().optional(),
  })
  .strict()
  .meta({ id: "PageDragAndDropResult" });

const PageTypeResultSchema = z
  .object({
    text: z.string(),
  })
  .strict()
  .meta({ id: "PageTypeResult" });

const PageKeyPressResultSchema = z
  .object({
    key: z.string(),
  })
  .strict()
  .meta({ id: "PageKeyPressResult" });

const PageNavigationResultSchema = z
  .object({
    url: z.string().optional(),
  })
  .strict()
  .meta({ id: "PageNavigationResult" });

const PageTitleResultSchema = z
  .object({
    title: z.string(),
  })
  .strict()
  .meta({ id: "PageTitleResult" });

const PageUrlResultSchema = z
  .object({
    url: z.string(),
  })
  .strict()
  .meta({ id: "PageUrlResult" });

const PageScreenshotResultSchema = z
  .object({
    base64: z.string(),
    mimeType: ScreenshotMimeTypeSchema,
  })
  .strict()
  .meta({ id: "PageScreenshotResult" });

const PageSnapshotResultSchema = z
  .object({
    formattedTree: z.string(),
    xpathMap: z.record(z.string(), z.string()),
    urlMap: z.record(z.string(), z.string()),
  })
  .strict()
  .meta({ id: "PageSnapshotResult" });

const PageSetViewportSizeResultSchema = z
  .object({
    width: z.number().positive(),
    height: z.number().positive(),
    deviceScaleFactor: z.number().positive().optional(),
  })
  .strict()
  .meta({ id: "PageSetViewportSizeResult" });

const PageWaitForLoadStateResultSchema = z
  .object({
    state: LoadStateSchema,
  })
  .strict()
  .meta({ id: "PageWaitForLoadStateResult" });

const PageWaitForSelectorResultSchema = z
  .object({
    selector: PageSelectorSchema,
    matched: z.boolean(),
  })
  .strict()
  .meta({ id: "PageWaitForSelectorResult" });

const PageWaitForTimeoutResultSchema = z
  .object({
    ms: z.number().int().positive(),
  })
  .strict()
  .meta({ id: "PageWaitForTimeoutResult" });

const PageEvaluateResultSchema = z
  .object({
    value: z.unknown(),
  })
  .strict()
  .meta({ id: "PageEvaluateResult" });

const PageSendCDPResultSchema = z
  .object({
    value: z.unknown(),
  })
  .strict()
  .meta({ id: "PageSendCDPResult" });

const PageCloseResultSchema = z
  .object({
    closed: z.boolean(),
  })
  .strict()
  .meta({ id: "PageCloseResult" });

export const PageClickActionSchema = createPageActionSchema(
  "PageClickAction",
  "click",
  PageClickParamsSchema,
  PageXPathResultSchema,
);

export const PageHoverActionSchema = createPageActionSchema(
  "PageHoverAction",
  "hover",
  PageHoverParamsSchema,
  PageXPathResultSchema,
);

export const PageScrollActionSchema = createPageActionSchema(
  "PageScrollAction",
  "scroll",
  PageScrollParamsSchema,
  PageXPathResultSchema,
);

export const PageDragAndDropActionSchema = createPageActionSchema(
  "PageDragAndDropAction",
  "dragAndDrop",
  PageDragAndDropParamsSchema,
  PageDragAndDropResultSchema,
);

export const PageTypeActionSchema = createPageActionSchema(
  "PageTypeAction",
  "type",
  PageTypeParamsSchema,
  PageTypeResultSchema,
);

export const PageKeyPressActionSchema = createPageActionSchema(
  "PageKeyPressAction",
  "keyPress",
  PageKeyPressParamsSchema,
  PageKeyPressResultSchema,
);

export const PageGotoActionSchema = createPageActionSchema(
  "PageGotoAction",
  "goto",
  PageGotoParamsSchema,
  PageNavigationResultSchema,
);

export const PageReloadActionSchema = createPageActionSchema(
  "PageReloadAction",
  "reload",
  PageReloadParamsSchema,
  PageNavigationResultSchema,
);

export const PageGoBackActionSchema = createPageActionSchema(
  "PageGoBackAction",
  "goBack",
  PageGoBackParamsSchema,
  PageNavigationResultSchema,
);

export const PageGoForwardActionSchema = createPageActionSchema(
  "PageGoForwardAction",
  "goForward",
  PageGoForwardParamsSchema,
  PageNavigationResultSchema,
);

export const PageTitleActionSchema = createPageActionSchema(
  "PageTitleAction",
  "title",
  PageTitleParamsSchema,
  PageTitleResultSchema,
);

export const PageUrlActionSchema = createPageActionSchema(
  "PageUrlAction",
  "url",
  PageUrlParamsSchema,
  PageUrlResultSchema,
);

export const PageScreenshotActionSchema = createPageActionSchema(
  "PageScreenshotAction",
  "screenshot",
  PageScreenshotParamsSchema,
  PageScreenshotResultSchema,
);

export const PageSnapshotActionSchema = createPageActionSchema(
  "PageSnapshotAction",
  "snapshot",
  PageSnapshotParamsSchema,
  PageSnapshotResultSchema,
);

export const PageSetViewportSizeActionSchema = createPageActionSchema(
  "PageSetViewportSizeAction",
  "setViewportSize",
  PageSetViewportSizeParamsSchema,
  PageSetViewportSizeResultSchema,
);

export const PageWaitForLoadStateActionSchema = createPageActionSchema(
  "PageWaitForLoadStateAction",
  "waitForLoadState",
  PageWaitForLoadStateParamsSchema,
  PageWaitForLoadStateResultSchema,
);

export const PageWaitForSelectorActionSchema = createPageActionSchema(
  "PageWaitForSelectorAction",
  "waitForSelector",
  PageWaitForSelectorParamsSchema,
  PageWaitForSelectorResultSchema,
);

export const PageWaitForTimeoutActionSchema = createPageActionSchema(
  "PageWaitForTimeoutAction",
  "waitForTimeout",
  PageWaitForTimeoutParamsSchema,
  PageWaitForTimeoutResultSchema,
);

export const PageEvaluateActionSchema = createPageActionSchema(
  "PageEvaluateAction",
  "evaluate",
  PageEvaluateParamsSchema,
  PageEvaluateResultSchema,
);

export const PageSendCDPActionSchema = createPageActionSchema(
  "PageSendCDPAction",
  "sendCDP",
  PageSendCDPParamsSchema,
  PageSendCDPResultSchema,
);

export const PageCloseActionSchema = createPageActionSchema(
  "PageCloseAction",
  "close",
  PageCloseParamsSchema,
  PageCloseResultSchema,
);

export const PageActionSchema = z
  .union([
    PageClickActionSchema,
    PageHoverActionSchema,
    PageScrollActionSchema,
    PageDragAndDropActionSchema,
    PageTypeActionSchema,
    PageKeyPressActionSchema,
    PageGotoActionSchema,
    PageReloadActionSchema,
    PageGoBackActionSchema,
    PageGoForwardActionSchema,
    PageTitleActionSchema,
    PageUrlActionSchema,
    PageScreenshotActionSchema,
    PageSnapshotActionSchema,
    PageSetViewportSizeActionSchema,
    PageWaitForLoadStateActionSchema,
    PageWaitForSelectorActionSchema,
    PageWaitForTimeoutActionSchema,
    PageEvaluateActionSchema,
    PageSendCDPActionSchema,
    PageCloseActionSchema,
  ])
  .meta({ id: "PageAction" });

export const PageClickResponseSchema = createPageResponseSchema(
  "PageClickResponse",
  PageClickActionSchema,
);

export const PageHoverResponseSchema = createPageResponseSchema(
  "PageHoverResponse",
  PageHoverActionSchema,
);

export const PageScrollResponseSchema = createPageResponseSchema(
  "PageScrollResponse",
  PageScrollActionSchema,
);

export const PageDragAndDropResponseSchema = createPageResponseSchema(
  "PageDragAndDropResponse",
  PageDragAndDropActionSchema,
);

export const PageTypeResponseSchema = createPageResponseSchema(
  "PageTypeResponse",
  PageTypeActionSchema,
);

export const PageKeyPressResponseSchema = createPageResponseSchema(
  "PageKeyPressResponse",
  PageKeyPressActionSchema,
);

export const PageGotoResponseSchema = createPageResponseSchema(
  "PageGotoResponse",
  PageGotoActionSchema,
);

export const PageReloadResponseSchema = createPageResponseSchema(
  "PageReloadResponse",
  PageReloadActionSchema,
);

export const PageGoBackResponseSchema = createPageResponseSchema(
  "PageGoBackResponse",
  PageGoBackActionSchema,
);

export const PageGoForwardResponseSchema = createPageResponseSchema(
  "PageGoForwardResponse",
  PageGoForwardActionSchema,
);

export const PageTitleResponseSchema = createPageResponseSchema(
  "PageTitleResponse",
  PageTitleActionSchema,
);

export const PageUrlResponseSchema = createPageResponseSchema(
  "PageUrlResponse",
  PageUrlActionSchema,
);

export const PageScreenshotResponseSchema = createPageResponseSchema(
  "PageScreenshotResponse",
  PageScreenshotActionSchema,
);

export const PageSnapshotResponseSchema = createPageResponseSchema(
  "PageSnapshotResponse",
  PageSnapshotActionSchema,
);

export const PageSetViewportSizeResponseSchema = createPageResponseSchema(
  "PageSetViewportSizeResponse",
  PageSetViewportSizeActionSchema,
);

export const PageWaitForLoadStateResponseSchema = createPageResponseSchema(
  "PageWaitForLoadStateResponse",
  PageWaitForLoadStateActionSchema,
);

export const PageWaitForSelectorResponseSchema = createPageResponseSchema(
  "PageWaitForSelectorResponse",
  PageWaitForSelectorActionSchema,
);

export const PageWaitForTimeoutResponseSchema = createPageResponseSchema(
  "PageWaitForTimeoutResponse",
  PageWaitForTimeoutActionSchema,
);

export const PageEvaluateResponseSchema = createPageResponseSchema(
  "PageEvaluateResponse",
  PageEvaluateActionSchema,
);

export const PageSendCDPResponseSchema = createPageResponseSchema(
  "PageSendCDPResponse",
  PageSendCDPActionSchema,
);

export const PageCloseResponseSchema = createPageResponseSchema(
  "PageCloseResponse",
  PageCloseActionSchema,
);

export const PageActionIdParamsSchema = z
  .object({
    actionId: ActionIdSchema,
  })
  .strict()
  .meta({ id: "PageActionIdParams" });

export const PageActionDetailsQuerySchema = z
  .object({
    id: RequestIdSchema.optional(),
    sessionId: SessionIdSchema,
  })
  .strict()
  .meta({ id: "PageActionDetailsQuery" });

export const PageActionListQuerySchema = z
  .object({
    id: RequestIdSchema.optional(),
    sessionId: SessionIdSchema,
    pageId: PageIdSchema.optional(),
    method: PageActionMethodSchema.optional(),
    status: PageActionStatusSchema.optional(),
    limit: z.coerce.number().int().positive().max(500).optional(),
  })
  .strict()
  .meta({ id: "PageActionListQuery" });

export const PageActionDetailsResponseSchema = z
  .object({
    id: RequestIdSchema,
    error: z.null(),
    result: z
      .object({
        action: PageActionSchema,
      })
      .strict(),
    metadata: PageMetadataSchema,
  })
  .strict()
  .meta({ id: "PageActionDetailsResponse" });

export const PageActionListResponseSchema = z
  .object({
    id: RequestIdSchema,
    error: z.null(),
    result: z
      .object({
        actions: z.array(PageActionSchema),
      })
      .strict(),
    metadata: PageMetadataSchema,
  })
  .strict()
  .meta({ id: "PageActionListResponse" });

export const pageOpenApiComponents = {
  schemas: {
    RequestId: RequestIdSchema,
    SessionId: SessionIdSchema,
    PageId: PageIdSchema,
    ActionId: ActionIdSchema,
    Timestamp: TimestampSchema,
    MouseButton: MouseButtonSchema,
    LoadState: LoadStateSchema,
    WaitForSelectorState: WaitForSelectorStateSchema,
    ScreenshotType: ScreenshotTypeSchema,
    ScreenshotMimeType: ScreenshotMimeTypeSchema,
    ScreenshotScale: ScreenshotScaleSchema,
    ScreenshotAnimations: ScreenshotAnimationsSchema,
    ScreenshotCaret: ScreenshotCaretSchema,
    PageActionMethod: PageActionMethodSchema,
    PageActionStatus: PageActionStatusSchema,
    PageSelector: PageSelectorSchema,
    PagePoint: PagePointSchema,
    PageClip: PageClipSchema,
    PageMetadata: PageMetadataSchema,
    PageError: PageErrorSchema,
    ValidationErrorResponse: ValidationErrorResponseSchema,
    V4ErrorResponse: V4ErrorResponseSchema,
    PageActionBase: PageActionBaseSchema,
    PageClickParams: PageClickParamsSchema,
    PageHoverParams: PageHoverParamsSchema,
    PageScrollParams: PageScrollParamsSchema,
    PageDragAndDropParams: PageDragAndDropParamsSchema,
    PageTypeParams: PageTypeParamsSchema,
    PageKeyPressParams: PageKeyPressParamsSchema,
    PageGotoParams: PageGotoParamsSchema,
    PageReloadParams: PageReloadParamsSchema,
    PageGoBackParams: PageGoBackParamsSchema,
    PageGoForwardParams: PageGoForwardParamsSchema,
    PageTitleParams: PageTitleParamsSchema,
    PageUrlParams: PageUrlParamsSchema,
    PageScreenshotParams: PageScreenshotParamsSchema,
    PageSnapshotParams: PageSnapshotParamsSchema,
    PageSetViewportSizeParams: PageSetViewportSizeParamsSchema,
    PageWaitForLoadStateParams: PageWaitForLoadStateParamsSchema,
    PageWaitForSelectorParams: PageWaitForSelectorParamsSchema,
    PageWaitForTimeoutParams: PageWaitForTimeoutParamsSchema,
    PageEvaluateParams: PageEvaluateParamsSchema,
    PageSendCDPParams: PageSendCDPParamsSchema,
    PageCloseParams: PageCloseParamsSchema,
    PageClickRequest: PageClickRequestSchema,
    PageHoverRequest: PageHoverRequestSchema,
    PageScrollRequest: PageScrollRequestSchema,
    PageDragAndDropRequest: PageDragAndDropRequestSchema,
    PageTypeRequest: PageTypeRequestSchema,
    PageKeyPressRequest: PageKeyPressRequestSchema,
    PageGotoRequest: PageGotoRequestSchema,
    PageReloadRequest: PageReloadRequestSchema,
    PageGoBackRequest: PageGoBackRequestSchema,
    PageGoForwardRequest: PageGoForwardRequestSchema,
    PageTitleRequest: PageTitleRequestSchema,
    PageUrlRequest: PageUrlRequestSchema,
    PageScreenshotRequest: PageScreenshotRequestSchema,
    PageSnapshotRequest: PageSnapshotRequestSchema,
    PageSetViewportSizeRequest: PageSetViewportSizeRequestSchema,
    PageWaitForLoadStateRequest: PageWaitForLoadStateRequestSchema,
    PageWaitForSelectorRequest: PageWaitForSelectorRequestSchema,
    PageWaitForTimeoutRequest: PageWaitForTimeoutRequestSchema,
    PageEvaluateRequest: PageEvaluateRequestSchema,
    PageSendCDPRequest: PageSendCDPRequestSchema,
    PageCloseRequest: PageCloseRequestSchema,
    PageClickAction: PageClickActionSchema,
    PageHoverAction: PageHoverActionSchema,
    PageScrollAction: PageScrollActionSchema,
    PageDragAndDropAction: PageDragAndDropActionSchema,
    PageTypeAction: PageTypeActionSchema,
    PageKeyPressAction: PageKeyPressActionSchema,
    PageGotoAction: PageGotoActionSchema,
    PageReloadAction: PageReloadActionSchema,
    PageGoBackAction: PageGoBackActionSchema,
    PageGoForwardAction: PageGoForwardActionSchema,
    PageTitleAction: PageTitleActionSchema,
    PageUrlAction: PageUrlActionSchema,
    PageScreenshotAction: PageScreenshotActionSchema,
    PageSnapshotAction: PageSnapshotActionSchema,
    PageSetViewportSizeAction: PageSetViewportSizeActionSchema,
    PageWaitForLoadStateAction: PageWaitForLoadStateActionSchema,
    PageWaitForSelectorAction: PageWaitForSelectorActionSchema,
    PageWaitForTimeoutAction: PageWaitForTimeoutActionSchema,
    PageEvaluateAction: PageEvaluateActionSchema,
    PageSendCDPAction: PageSendCDPActionSchema,
    PageCloseAction: PageCloseActionSchema,
    PageAction: PageActionSchema,
    PageClickResponse: PageClickResponseSchema,
    PageHoverResponse: PageHoverResponseSchema,
    PageScrollResponse: PageScrollResponseSchema,
    PageDragAndDropResponse: PageDragAndDropResponseSchema,
    PageTypeResponse: PageTypeResponseSchema,
    PageKeyPressResponse: PageKeyPressResponseSchema,
    PageGotoResponse: PageGotoResponseSchema,
    PageReloadResponse: PageReloadResponseSchema,
    PageGoBackResponse: PageGoBackResponseSchema,
    PageGoForwardResponse: PageGoForwardResponseSchema,
    PageTitleResponse: PageTitleResponseSchema,
    PageUrlResponse: PageUrlResponseSchema,
    PageScreenshotResponse: PageScreenshotResponseSchema,
    PageSnapshotResponse: PageSnapshotResponseSchema,
    PageSetViewportSizeResponse: PageSetViewportSizeResponseSchema,
    PageWaitForLoadStateResponse: PageWaitForLoadStateResponseSchema,
    PageWaitForSelectorResponse: PageWaitForSelectorResponseSchema,
    PageWaitForTimeoutResponse: PageWaitForTimeoutResponseSchema,
    PageEvaluateResponse: PageEvaluateResponseSchema,
    PageSendCDPResponse: PageSendCDPResponseSchema,
    PageCloseResponse: PageCloseResponseSchema,
    PageActionIdParams: PageActionIdParamsSchema,
    PageActionDetailsQuery: PageActionDetailsQuerySchema,
    PageActionListQuery: PageActionListQuerySchema,
    PageActionDetailsResponse: PageActionDetailsResponseSchema,
    PageActionListResponse: PageActionListResponseSchema,
  },
};

export type PageActionMethod = z.infer<typeof PageActionMethodSchema>;
export type PageActionStatus = z.infer<typeof PageActionStatusSchema>;
export type PageAction = z.infer<typeof PageActionSchema>;
export type PageActionDetailsQuery = z.infer<
  typeof PageActionDetailsQuerySchema
>;
export type PageActionListQuery = z.infer<typeof PageActionListQuerySchema>;

export function buildErrorResponse(input: {
  id: string;
  error: z.input<typeof PageErrorSchema>;
  metadata: Omit<z.input<typeof PageMetadataSchema>, "timestamp"> & {
    timestamp?: string;
  };
}) {
  return V4ErrorResponseSchema.parse({
    id: input.id,
    error: input.error,
    result: null,
    metadata: {
      ...input.metadata,
      timestamp: input.metadata.timestamp ?? new Date().toISOString(),
    },
  });
}
