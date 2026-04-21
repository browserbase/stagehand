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

export const FrameIdSchema = z
  .string()
  .min(1)
  .meta({ id: "FrameId", example: "frame_01JXAMPLE" });

export const ActionIdSchema = z
  .string()
  .min(1)
  .meta({ id: "ActionId", example: "action_01JXAMPLE" });

export const CDPSessionIdSchema = z
  .string()
  .min(1)
  .meta({ id: "CDPSessionId", example: "cdp-session_01JXAMPLE" });

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
    "enableCursorOverlay",
    "addInitScript",
    "goto",
    "reload",
    "goBack",
    "goForward",
    "targetId",
    "mainFrameId",
    "getFullFrameTree",
    "listAllFrameIds",
    "title",
    "url",
    "screenshot",
    "snapshot",
    "frames",
    "setViewportSize",
    "setExtraHTTPHeaders",
    "waitForLoadState",
    "waitForSelector",
    "waitForTimeout",
    "evaluate",
    "sendCDP",
    "close",
    "elementInfo",
    "fill",
    "highlight",
    "selectOption",
    "setInputFiles",
  ])
  .meta({ id: "PageActionMethod" });

export const PageActionStatusSchema = z
  .enum(["queued", "running", "completed", "failed", "canceled"])
  .meta({ id: "PageActionStatus" });

export const XPathSelectorSchema = z
  .object({
    xpath: z.string().min(1).meta({ example: "//button[text()='Submit']" }),
    idx: z.number().int().nonnegative().optional().meta({ example: 0 }),
  })
  .strict()
  .meta({ id: "XPathSelector" });

export const CssSelectorSchema = z
  .object({
    css: z.string().min(1).meta({ example: ".btn-submit" }),
    idx: z.number().int().nonnegative().optional().meta({ example: 0 }),
  })
  .strict()
  .meta({ id: "CssSelector" });

export const TextSelectorSchema = z
  .object({
    text: z.string().min(1).meta({ example: "Submit" }),
    idx: z.number().int().nonnegative().optional().meta({ example: 0 }),
  })
  .strict()
  .meta({ id: "TextSelector" });

export const CoordinateSelectorSchema = z
  .object({
    x: z.number(),
    y: z.number(),
  })
  .strict()
  .meta({ id: "CoordinateSelector" });

// Full union (all 4 types)
export const SelectorSchema = z
  .union([
    XPathSelectorSchema,
    CssSelectorSchema,
    TextSelectorSchema,
    CoordinateSelectorSchema,
  ])
  .meta({ id: "Selector" });

// Element-only (no coordinates) — for waitForSelector
export const ElementSelectorSchema = z
  .union([XPathSelectorSchema, CssSelectorSchema, TextSelectorSchema])
  .meta({ id: "ElementSelector" });

export const PageHeadersSchema = z
  .object({})
  .catchall(z.string())
  .meta({ id: "PageHeaders" });

export const PageInitScriptSchema = z
  .union([
    z.string().min(1),
    z
      .object({
        path: z.string().min(1).optional(),
        content: z.string().min(1).optional(),
      })
      .strict()
      .refine(
        (value) => value.path !== undefined || value.content !== undefined,
        {
          message: "script must include path or content",
        },
      ),
  ])
  .meta({ id: "PageInitScript" });

export const PageClipSchema = z
  .object({
    x: z.number(),
    y: z.number(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict()
  .meta({ id: "PageClip" });

export const PageErrorSchema = z.string().min(1).meta({ id: "PageError" });

export const ValidationErrorResponseSchema = z
  .object({
    success: z.literal(false),
    error: PageErrorSchema,
    statusCode: z.number().int(),
    stack: z.string().nullable(),
    action: z.lazy(() => PageActionSchema).optional(),
  })
  .strict()
  .meta({ id: "ValidationErrorResponse" });

const PageBodySchema = z
  .object({
    id: RequestIdSchema.optional(),
    sessionId: SessionIdSchema,
  })
  .strict();

const PageQuerySchemaBase = z
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
      success: z.literal(true),
      error: z.null(),
      action,
    })
    .strict()
    .meta({ id });
}

export const PageClickParamsSchema = PageWithPageIdSchema.extend({
  selector: SelectorSchema,
  button: MouseButtonSchema.optional(),
  clickCount: z.number().int().lte(3).gte(1).optional(),
  returnSelector: z.boolean().default(false).optional(),
  method: z.enum(["jsevent", "xy"]).default("xy"),
  // TODO: add expectDownload, expectNavigation, expectPopup  OR expect: z.enum(...)
})
  .strict()
  .meta({ id: "PageClickParams" });

export const PageHoverParamsSchema = PageWithPageIdSchema.extend({
  selector: SelectorSchema,
  returnSelector: z.boolean().default(false).optional(),
})
  .strict()
  .meta({ id: "PageHoverParams" });

export const PageScrollByOffsetParamsSchema = PageWithPageIdSchema.extend({
  cursorPosition: SelectorSchema.optional(),
  offset: z
    .object({
      x: z.number().default(0),
      y: z.number(),
    })
    .strict(),
})
  .strict()
  .meta({ id: "PageScrollByOffsetParams" });

export const PageScrollByPagesParamsSchema = PageWithPageIdSchema.extend({
  cursorPosition: SelectorSchema.optional(),
  pages: z.number().lte(100).gte(-100).default(1),
  delayBetweenMs: z.number().int().min(0).optional(),
})
  .strict()
  .meta({ id: "PageScrollByPagesParams" });

export const PageScrollToTargetParamsSchema = PageWithPageIdSchema.extend({
  target: SelectorSchema,
  position: z.enum(["center", "top", "bottom"]).default("center"),
})
  .strict()
  .meta({ id: "PageScrollToTargetParams" });

export const PageScrollParamsSchema = z
  .union([
    PageScrollByOffsetParamsSchema,
    PageScrollByPagesParamsSchema,
    PageScrollToTargetParamsSchema,
  ])
  .meta({ id: "PageScrollParams" });

export const PageDragAndDropParamsSchema = PageWithPageIdSchema.extend({
  from: SelectorSchema,
  to: SelectorSchema,
  button: MouseButtonSchema.optional(),
  steps: z.number().int().positive().optional(),
  delay: z.number().int().min(0).optional(),
  returnSelector: z.boolean().default(false).optional(),
})
  .strict()
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
  url: z.url(),
  waitUntil: LoadStateSchema.optional(),
  timeoutMs: z.number().int().nonnegative().optional(),
})
  .strict()
  .meta({ id: "PageGotoParams" });

export const PageReloadParamsSchema = PageWithPageIdSchema.extend({
  waitUntil: LoadStateSchema.optional(),
  timeoutMs: z.number().int().nonnegative().optional(),
  ignoreCache: z.boolean().optional(),
})
  .strict()
  .meta({ id: "PageReloadParams" });

export const PageGoBackParamsSchema = PageWithPageIdSchema.extend({
  waitUntil: LoadStateSchema.optional(),
  timeoutMs: z.number().int().nonnegative().optional(),
})
  .strict()
  .meta({ id: "PageGoBackParams" });

export const PageGoForwardParamsSchema = PageWithPageIdSchema.extend({
  waitUntil: LoadStateSchema.optional(),
  timeoutMs: z.number().int().nonnegative().optional(),
})
  .strict()
  .meta({ id: "PageGoForwardParams" });

export const PageEnableCursorOverlayParamsSchema = PageWithPageIdSchema.meta({
  id: "PageEnableCursorOverlayParams",
});

export const PageAddInitScriptParamsSchema = PageWithPageIdSchema.extend({
  script: PageInitScriptSchema,
})
  .strict()
  .meta({ id: "PageAddInitScriptParams" });

export const PageTargetIdParamsSchema = PageWithPageIdSchema.meta({
  id: "PageTargetIdParams",
});

export const PageMainFrameIdParamsSchema = PageWithPageIdSchema.meta({
  id: "PageMainFrameIdParams",
});

export const PageGetFullFrameTreeParamsSchema = PageWithPageIdSchema.meta({
  id: "PageGetFullFrameTreeParams",
});

export const PageListAllFrameIdsParamsSchema = PageWithPageIdSchema.meta({
  id: "PageListAllFrameIdsParams",
});

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
  timeout: z.number().int().nonnegative().optional(),
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

export const PageFramesParamsSchema = PageWithPageIdSchema.meta({
  id: "PageFramesParams",
});

export const PageSetViewportSizeParamsSchema = PageWithPageIdSchema.extend({
  width: z.number().positive(),
  height: z.number().positive(),
  deviceScaleFactor: z.number().positive().optional(),
})
  .strict()
  .meta({ id: "PageSetViewportSizeParams" });

export const PageSetExtraHTTPHeadersParamsSchema = PageWithPageIdSchema.extend({
  headers: PageHeadersSchema,
})
  .strict()
  .meta({ id: "PageSetExtraHTTPHeadersParams" });

export const PageWaitForLoadStateParamsSchema = PageWithPageIdSchema.extend({
  state: LoadStateSchema,
  timeoutMs: z.number().int().nonnegative().optional(),
})
  .strict()
  .meta({ id: "PageWaitForLoadStateParams" });

export const PageWaitForSelectorParamsSchema = PageWithPageIdSchema.extend({
  selector: ElementSelectorSchema,
  state: WaitForSelectorStateSchema.optional(),
  timeout: z.number().int().nonnegative().optional(),
  pierceShadow: z.boolean().optional(),
})
  .strict()
  .meta({ id: "PageWaitForSelectorParams" });

export const PageWaitForTimeoutParamsSchema = PageWithPageIdSchema.extend({
  ms: z.number().int().nonnegative(),
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

export const ElementInfoFieldSchema = z
  .enum([
    "visibility",
    "domRects",
    "content",
    "inputInfo",
    "ariaInfo",
    "attributes",
    "styles",
  ])
  .meta({ id: "ElementInfoField" });

export const PageElementInfoParamsSchema = PageWithPageIdSchema.extend({
  selector: SelectorSchema,
  fields: z.array(ElementInfoFieldSchema).optional(),
})
  .strict()
  .meta({ id: "PageElementInfoParams" });

export const PageFillParamsSchema = PageWithPageIdSchema.extend({
  selector: SelectorSchema,
  value: z.string(),
  returnSelector: z.boolean().default(false).optional(),
})
  .strict()
  .meta({ id: "PageFillParams" });

export const PageHighlightParamsSchema = PageWithPageIdSchema.extend({
  selector: SelectorSchema,
  color: z.string().optional(),
  durationMs: z.number().int().min(0).optional(),
  returnSelector: z.boolean().default(false).optional(),
})
  .strict()
  .meta({ id: "PageHighlightParams" });

export const PageSelectOptionParamsSchema = PageWithPageIdSchema.extend({
  selector: SelectorSchema,
  values: z.array(z.string()),
  returnSelector: z.boolean().default(false).optional(),
})
  .strict()
  .meta({ id: "PageSelectOptionParams" });

export const PageSetInputFilesParamsSchema = PageWithPageIdSchema.extend({
  selector: SelectorSchema,
  files: z.array(
    z
      .object({
        name: z.string(),
        mimeType: z.string(),
        base64: z.string(),
      })
      .strict(),
  ),
  returnSelector: z.boolean().default(false).optional(),
})
  .strict()
  .meta({ id: "PageSetInputFilesParams" });

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

export const PageEnableCursorOverlayRequestSchema = createPageRequestSchema(
  "PageEnableCursorOverlayRequest",
  PageEnableCursorOverlayParamsSchema,
);

export const PageAddInitScriptRequestSchema = createPageRequestSchema(
  "PageAddInitScriptRequest",
  PageAddInitScriptParamsSchema,
);

export const PageTargetIdRequestSchema = PageQuerySchemaBase.extend(
  PageTargetIdParamsSchema.shape,
).meta({ id: "PageTargetIdRequest" });

export const PageMainFrameIdRequestSchema = PageQuerySchemaBase.extend(
  PageMainFrameIdParamsSchema.shape,
).meta({ id: "PageMainFrameIdRequest" });

export const PageGetFullFrameTreeRequestSchema = PageQuerySchemaBase.extend(
  PageGetFullFrameTreeParamsSchema.shape,
).meta({ id: "PageGetFullFrameTreeRequest" });

export const PageListAllFrameIdsRequestSchema = PageQuerySchemaBase.extend(
  PageListAllFrameIdsParamsSchema.shape,
).meta({ id: "PageListAllFrameIdsRequest" });

export const PageTitleRequestSchema = PageQuerySchemaBase.extend(
  PageTitleParamsSchema.shape,
).meta({ id: "PageTitleRequest" });

export const PageUrlRequestSchema = PageQuerySchemaBase.extend(
  PageUrlParamsSchema.shape,
).meta({ id: "PageUrlRequest" });

export const PageScreenshotRequestSchema = createPageRequestSchema(
  "PageScreenshotRequest",
  PageScreenshotParamsSchema,
);

export const PageSnapshotRequestSchema = createPageRequestSchema(
  "PageSnapshotRequest",
  PageSnapshotParamsSchema,
);

export const PageFramesRequestSchema = PageQuerySchemaBase.extend(
  PageFramesParamsSchema.shape,
).meta({ id: "PageFramesRequest" });

export const PageSetViewportSizeRequestSchema = createPageRequestSchema(
  "PageSetViewportSizeRequest",
  PageSetViewportSizeParamsSchema,
);

export const PageSetExtraHTTPHeadersRequestSchema = createPageRequestSchema(
  "PageSetExtraHTTPHeadersRequest",
  PageSetExtraHTTPHeadersParamsSchema,
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

export const PageElementInfoRequestSchema = createPageRequestSchema(
  "PageElementInfoRequest",
  PageElementInfoParamsSchema,
);

export const PageFillRequestSchema = createPageRequestSchema(
  "PageFillRequest",
  PageFillParamsSchema,
);

export const PageHighlightRequestSchema = createPageRequestSchema(
  "PageHighlightRequest",
  PageHighlightParamsSchema,
);

export const PageSelectOptionRequestSchema = createPageRequestSchema(
  "PageSelectOptionRequest",
  PageSelectOptionParamsSchema,
);

export const PageSetInputFilesRequestSchema = createPageRequestSchema(
  "PageSetInputFilesRequest",
  PageSetInputFilesParamsSchema,
);

export const PageScrollResultSchema = z
  .object({
    x: z.number(),
    y: z.number(),
  })
  .strict()
  .meta({ id: "PageScrollResult" });

export const ResultSelectorSchema = z
  .object({
    xpath: z.string().optional(),
    css: z.string().optional(),
    text: z.string().optional(),
    coordinates: z
      .object({
        x: z.number(),
        y: z.number(),
      })
      .optional(),
  })
  .strict()
  .meta({ id: "ResultSelector" });

export const PageClickResultSchema = z
  .object({
    selector: ResultSelectorSchema,
  })
  .strict()
  .meta({ id: "PageClickResult" });

export const PageHoverResultSchema = z
  .object({
    selector: ResultSelectorSchema,
  })
  .strict()
  .meta({ id: "PageHoverResult" });

export const PageDragAndDropResultSchema = z
  .object({
    startSelector: ResultSelectorSchema,
    endSelector: ResultSelectorSchema,
  })
  .strict()
  .meta({ id: "PageDragAndDropResult" });

export const PageTypeResultSchema = z
  .object({
    text: z.string(),
  })
  .strict()
  .meta({ id: "PageTypeResult" });

export const PageKeyPressResultSchema = z
  .object({
    key: z.string(),
  })
  .strict()
  .meta({ id: "PageKeyPressResult" });

export const PageEnableCursorOverlayResultSchema = z
  .object({
    enabled: z.boolean(),
  })
  .strict()
  .meta({ id: "PageEnableCursorOverlayResult" });

export const PageAddInitScriptResultSchema = z
  .object({
    added: z.boolean(),
  })
  .strict()
  .meta({ id: "PageAddInitScriptResult" });

export const PageNavigationResultSchema = z
  .object({
    url: z.string(),
    response: z
      .object({
        url: z.string(),
        status: z.number().int(),
        statusText: z.string(),
        ok: z.boolean(),
        headers: PageHeadersSchema,
      })
      .strict()
      .nullable(),
  })
  .strict()
  .meta({ id: "PageNavigationResult" });

export const PageTargetIdResultSchema = z
  .object({
    targetId: PageIdSchema,
  })
  .strict()
  .meta({ id: "PageTargetIdResult" });

export const PageMainFrameIdResultSchema = z
  .object({
    mainFrameId: FrameIdSchema,
  })
  .strict()
  .meta({ id: "PageMainFrameIdResult" });

export const PageFrameSchema = z
  .object({
    frameId: FrameIdSchema,
    pageId: PageIdSchema,
    sessionId: CDPSessionIdSchema.nullable(),
    isBrowserRemote: z.boolean(),
  })
  .strict()
  .meta({ id: "PageFrame" });

export const PageFrameTreeResultSchema = z
  .object({
    frameTree: z.unknown(),
  })
  .strict()
  .meta({ id: "PageFrameTreeResult" });

export const PageListAllFrameIdsResultSchema = z
  .object({
    frameIds: z.array(FrameIdSchema),
  })
  .strict()
  .meta({ id: "PageListAllFrameIdsResult" });

export const PageTitleResultSchema = z
  .object({
    title: z.string(),
  })
  .strict()
  .meta({ id: "PageTitleResult" });

export const PageUrlResultSchema = z
  .object({
    url: z.string(),
  })
  .strict()
  .meta({ id: "PageUrlResult" });

export const PageScreenshotResultSchema = z
  .object({
    base64: z.string(),
    mimeType: ScreenshotMimeTypeSchema,
  })
  .strict()
  .meta({ id: "PageScreenshotResult" });

export const PageSnapshotResultSchema = z
  .object({
    formattedTree: z.string(),
    xpathMap: z.object({}).catchall(z.string()),
    urlMap: z.object({}).catchall(z.string()),
  })
  .strict()
  .meta({ id: "PageSnapshotResult" });

export const PageSetViewportSizeResultSchema = z
  .object({
    width: z.number().positive(),
    height: z.number().positive(),
    deviceScaleFactor: z.number().positive().optional(),
  })
  .strict()
  .meta({ id: "PageSetViewportSizeResult" });

export const PageFramesResultSchema = z
  .object({
    frames: z.array(PageFrameSchema),
  })
  .strict()
  .meta({ id: "PageFramesResult" });

export const PageSetExtraHTTPHeadersResultSchema = z
  .object({
    headers: PageHeadersSchema,
  })
  .strict()
  .meta({ id: "PageSetExtraHTTPHeadersResult" });

export const PageWaitForLoadStateResultSchema = z
  .object({
    state: LoadStateSchema,
  })
  .strict()
  .meta({ id: "PageWaitForLoadStateResult" });

export const PageWaitForSelectorResultSchema = z
  .object({
    selector: ElementSelectorSchema,
    matched: z.boolean(),
  })
  .strict()
  .meta({ id: "PageWaitForSelectorResult" });

export const PageWaitForTimeoutResultSchema = z
  .object({
    ms: z.number().int().nonnegative(),
  })
  .strict()
  .meta({ id: "PageWaitForTimeoutResult" });

export const PageEvaluateResultSchema = z
  .object({
    value: z.unknown(),
  })
  .strict()
  .meta({ id: "PageEvaluateResult" });

export const PageSendCDPResultSchema = z
  .object({
    value: z.unknown(),
  })
  .strict()
  .meta({ id: "PageSendCDPResult" });

export const PageCloseResultSchema = z
  .object({
    closed: z.boolean(),
  })
  .strict()
  .meta({ id: "PageCloseResult" });

export const PageFillResultSchema = z
  .object({
    selector: ResultSelectorSchema,
    value: z.string(),
  })
  .strict()
  .meta({ id: "PageFillResult" });

export const PageHighlightResultSchema = z
  .object({
    selector: ResultSelectorSchema,
    highlighted: z.boolean(),
  })
  .strict()
  .meta({ id: "PageHighlightResult" });

export const PageSelectOptionResultSchema = z
  .object({
    selector: ResultSelectorSchema,
    selected: z.array(z.string()),
  })
  .strict()
  .meta({ id: "PageSelectOptionResult" });

export const PageSetInputFilesResultSchema = z
  .object({
    selector: ResultSelectorSchema,
    files: z.array(z.string()),
  })
  .strict()
  .meta({ id: "PageSetInputFilesResult" });

export const ElementInfoVisibilitySchema = z
  .object({
    isInViewport: z.boolean(),
    isOccluded: z.boolean(),
  })
  .strict()
  .meta({ id: "ElementInfoVisibility" });

export const ElementInfoDomRectSchema = z
  .object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  })
  .strict()
  .meta({ id: "ElementInfoDomRect" });

export const ElementInfoDomRectsSchema = z
  .object({
    rects: z.array(ElementInfoDomRectSchema),
  })
  .strict()
  .meta({ id: "ElementInfoDomRects" });

export const ElementInfoContentSchema = z
  .object({
    innerText: z.string(),
    textContent: z.string(),
    innerHTML: z.string(),
  })
  .strict()
  .meta({ id: "ElementInfoContent" });

export const ElementInfoInputInfoSchema = z
  .object({
    value: z.string(),
    isChecked: z.boolean(),
  })
  .strict()
  .meta({ id: "ElementInfoInputInfo" });

export const ElementInfoAriaInfoSchema = z
  .object({
    role: z.string(),
    attributes: z.record(z.string(), z.string()),
  })
  .strict()
  .meta({ id: "ElementInfoAriaInfo" });

export const ElementInfoAttributesSchema = z
  .object({
    values: z.record(z.string(), z.string()),
  })
  .strict()
  .meta({ id: "ElementInfoAttributes" });

export const ElementInfoStylesSchema = z
  .object({
    computed: z.record(z.string(), z.string()),
  })
  .strict()
  .meta({ id: "ElementInfoStyles" });

export const PageElementInfoResultSchema = z
  .object({
    count: z.number().int().nonnegative().default(0),
    selector: ResultSelectorSchema.default({}),
    tagName: z.string(),
    backendNodeId: z.number().int().nonnegative(),
    visibility: ElementInfoVisibilitySchema.default({
      isInViewport: false,
      isOccluded: false,
    }),
    domRects: ElementInfoDomRectsSchema.default({ rects: [] }),
    content: ElementInfoContentSchema.default({
      innerText: "",
      textContent: "",
      innerHTML: "",
    }),
    inputInfo: ElementInfoInputInfoSchema.optional(),
    ariaInfo: ElementInfoAriaInfoSchema.optional(),
    attributes: ElementInfoAttributesSchema.optional(),
    styles: ElementInfoStylesSchema.optional(),
  })
  .strict()
  .meta({ id: "PageElementInfoResult" });

export const PageClickActionSchema = createPageActionSchema(
  "PageClickAction",
  "click",
  PageClickParamsSchema,
  PageClickResultSchema,
);

export const PageHoverActionSchema = createPageActionSchema(
  "PageHoverAction",
  "hover",
  PageHoverParamsSchema,
  PageHoverResultSchema,
);

export const PageScrollActionSchema = createPageActionSchema(
  "PageScrollAction",
  "scroll",
  PageScrollParamsSchema,
  PageScrollResultSchema,
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

export const PageEnableCursorOverlayActionSchema = createPageActionSchema(
  "PageEnableCursorOverlayAction",
  "enableCursorOverlay",
  PageEnableCursorOverlayParamsSchema,
  PageEnableCursorOverlayResultSchema,
);

export const PageAddInitScriptActionSchema = createPageActionSchema(
  "PageAddInitScriptAction",
  "addInitScript",
  PageAddInitScriptParamsSchema,
  PageAddInitScriptResultSchema,
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

export const PageTargetIdActionSchema = createPageActionSchema(
  "PageTargetIdAction",
  "targetId",
  PageTargetIdParamsSchema,
  PageTargetIdResultSchema,
);

export const PageMainFrameIdActionSchema = createPageActionSchema(
  "PageMainFrameIdAction",
  "mainFrameId",
  PageMainFrameIdParamsSchema,
  PageMainFrameIdResultSchema,
);

export const PageGetFullFrameTreeActionSchema = createPageActionSchema(
  "PageGetFullFrameTreeAction",
  "getFullFrameTree",
  PageGetFullFrameTreeParamsSchema,
  PageFrameTreeResultSchema,
);

export const PageListAllFrameIdsActionSchema = createPageActionSchema(
  "PageListAllFrameIdsAction",
  "listAllFrameIds",
  PageListAllFrameIdsParamsSchema,
  PageListAllFrameIdsResultSchema,
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

export const PageFramesActionSchema = createPageActionSchema(
  "PageFramesAction",
  "frames",
  PageFramesParamsSchema,
  PageFramesResultSchema,
);

export const PageSetViewportSizeActionSchema = createPageActionSchema(
  "PageSetViewportSizeAction",
  "setViewportSize",
  PageSetViewportSizeParamsSchema,
  PageSetViewportSizeResultSchema,
);

export const PageSetExtraHTTPHeadersActionSchema = createPageActionSchema(
  "PageSetExtraHTTPHeadersAction",
  "setExtraHTTPHeaders",
  PageSetExtraHTTPHeadersParamsSchema,
  PageSetExtraHTTPHeadersResultSchema,
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

export const PageFillActionSchema = createPageActionSchema(
  "PageFillAction",
  "fill",
  PageFillParamsSchema,
  PageFillResultSchema,
);

export const PageHighlightActionSchema = createPageActionSchema(
  "PageHighlightAction",
  "highlight",
  PageHighlightParamsSchema,
  PageHighlightResultSchema,
);

export const PageSelectOptionActionSchema = createPageActionSchema(
  "PageSelectOptionAction",
  "selectOption",
  PageSelectOptionParamsSchema,
  PageSelectOptionResultSchema,
);

export const PageSetInputFilesActionSchema = createPageActionSchema(
  "PageSetInputFilesAction",
  "setInputFiles",
  PageSetInputFilesParamsSchema,
  PageSetInputFilesResultSchema,
);

export const PageElementInfoActionSchema = createPageActionSchema(
  "PageElementInfoAction",
  "elementInfo",
  PageElementInfoParamsSchema,
  PageElementInfoResultSchema,
);

export const PageActionSchema = z
  .union([
    PageClickActionSchema,
    PageHoverActionSchema,
    PageScrollActionSchema,
    PageDragAndDropActionSchema,
    PageTypeActionSchema,
    PageKeyPressActionSchema,
    PageEnableCursorOverlayActionSchema,
    PageAddInitScriptActionSchema,
    PageGotoActionSchema,
    PageReloadActionSchema,
    PageGoBackActionSchema,
    PageGoForwardActionSchema,
    PageTargetIdActionSchema,
    PageMainFrameIdActionSchema,
    PageGetFullFrameTreeActionSchema,
    PageListAllFrameIdsActionSchema,
    PageTitleActionSchema,
    PageUrlActionSchema,
    PageScreenshotActionSchema,
    PageSnapshotActionSchema,
    PageFramesActionSchema,
    PageSetViewportSizeActionSchema,
    PageSetExtraHTTPHeadersActionSchema,
    PageWaitForLoadStateActionSchema,
    PageWaitForSelectorActionSchema,
    PageWaitForTimeoutActionSchema,
    PageEvaluateActionSchema,
    PageSendCDPActionSchema,
    PageCloseActionSchema,
    PageElementInfoActionSchema,
    PageFillActionSchema,
    PageHighlightActionSchema,
    PageSelectOptionActionSchema,
    PageSetInputFilesActionSchema,
  ])
  .meta({ id: "PageAction" });

export const V4ErrorResponseSchema = z
  .object({
    success: z.literal(false),
    error: PageErrorSchema,
    statusCode: z.number().int(),
    stack: z.string().nullable(),
    action: PageActionSchema.optional(),
  })
  .strict()
  .meta({ id: "V4ErrorResponse" });

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

export const PageEnableCursorOverlayResponseSchema = createPageResponseSchema(
  "PageEnableCursorOverlayResponse",
  PageEnableCursorOverlayActionSchema,
);

export const PageAddInitScriptResponseSchema = createPageResponseSchema(
  "PageAddInitScriptResponse",
  PageAddInitScriptActionSchema,
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

export const PageTargetIdResponseSchema = createPageResponseSchema(
  "PageTargetIdResponse",
  PageTargetIdActionSchema,
);

export const PageMainFrameIdResponseSchema = createPageResponseSchema(
  "PageMainFrameIdResponse",
  PageMainFrameIdActionSchema,
);

export const PageGetFullFrameTreeResponseSchema = createPageResponseSchema(
  "PageGetFullFrameTreeResponse",
  PageGetFullFrameTreeActionSchema,
);

export const PageListAllFrameIdsResponseSchema = createPageResponseSchema(
  "PageListAllFrameIdsResponse",
  PageListAllFrameIdsActionSchema,
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

export const PageFramesResponseSchema = createPageResponseSchema(
  "PageFramesResponse",
  PageFramesActionSchema,
);

export const PageSetViewportSizeResponseSchema = createPageResponseSchema(
  "PageSetViewportSizeResponse",
  PageSetViewportSizeActionSchema,
);

export const PageSetExtraHTTPHeadersResponseSchema = createPageResponseSchema(
  "PageSetExtraHTTPHeadersResponse",
  PageSetExtraHTTPHeadersActionSchema,
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

export const PageFillResponseSchema = createPageResponseSchema(
  "PageFillResponse",
  PageFillActionSchema,
);

export const PageHighlightResponseSchema = createPageResponseSchema(
  "PageHighlightResponse",
  PageHighlightActionSchema,
);

export const PageSelectOptionResponseSchema = createPageResponseSchema(
  "PageSelectOptionResponse",
  PageSelectOptionActionSchema,
);

export const PageSetInputFilesResponseSchema = createPageResponseSchema(
  "PageSetInputFilesResponse",
  PageSetInputFilesActionSchema,
);

export const PageElementInfoResponseSchema = createPageResponseSchema(
  "PageElementInfoResponse",
  PageElementInfoActionSchema,
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
    success: z.literal(true),
    error: z.null(),
    action: PageActionSchema,
  })
  .strict()
  .meta({ id: "PageActionDetailsResponse" });

export const PageActionListResponseSchema = z
  .object({
    success: z.literal(true),
    error: z.null(),
    actions: z.array(PageActionSchema),
  })
  .strict()
  .meta({ id: "PageActionListResponse" });

export const pageOpenApiComponents = {
  schemas: {
    RequestId: RequestIdSchema,
    SessionId: SessionIdSchema,
    PageId: PageIdSchema,
    FrameId: FrameIdSchema,
    ActionId: ActionIdSchema,
    CDPSessionId: CDPSessionIdSchema,
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
    XPathSelector: XPathSelectorSchema,
    CssSelector: CssSelectorSchema,
    TextSelector: TextSelectorSchema,
    CoordinateSelector: CoordinateSelectorSchema,
    Selector: SelectorSchema,
    ElementSelector: ElementSelectorSchema,
    ResultSelector: ResultSelectorSchema,
    PageHeaders: PageHeadersSchema,
    PageInitScript: PageInitScriptSchema,
    PageClip: PageClipSchema,
    PageError: PageErrorSchema,
    ValidationErrorResponse: ValidationErrorResponseSchema,
    V4ErrorResponse: V4ErrorResponseSchema,
    PageActionBase: PageActionBaseSchema,
    PageClickParams: PageClickParamsSchema,
    PageHoverParams: PageHoverParamsSchema,
    PageScrollByOffsetParams: PageScrollByOffsetParamsSchema,
    PageScrollByPagesParams: PageScrollByPagesParamsSchema,
    PageScrollToTargetParams: PageScrollToTargetParamsSchema,
    PageScrollParams: PageScrollParamsSchema,
    PageDragAndDropParams: PageDragAndDropParamsSchema,
    PageTypeParams: PageTypeParamsSchema,
    PageKeyPressParams: PageKeyPressParamsSchema,
    PageEnableCursorOverlayParams: PageEnableCursorOverlayParamsSchema,
    PageAddInitScriptParams: PageAddInitScriptParamsSchema,
    PageGotoParams: PageGotoParamsSchema,
    PageReloadParams: PageReloadParamsSchema,
    PageGoBackParams: PageGoBackParamsSchema,
    PageGoForwardParams: PageGoForwardParamsSchema,
    PageTargetIdParams: PageTargetIdParamsSchema,
    PageMainFrameIdParams: PageMainFrameIdParamsSchema,
    PageGetFullFrameTreeParams: PageGetFullFrameTreeParamsSchema,
    PageListAllFrameIdsParams: PageListAllFrameIdsParamsSchema,
    PageTitleParams: PageTitleParamsSchema,
    PageUrlParams: PageUrlParamsSchema,
    PageScreenshotParams: PageScreenshotParamsSchema,
    PageSnapshotParams: PageSnapshotParamsSchema,
    PageFramesParams: PageFramesParamsSchema,
    PageSetViewportSizeParams: PageSetViewportSizeParamsSchema,
    PageSetExtraHTTPHeadersParams: PageSetExtraHTTPHeadersParamsSchema,
    PageWaitForLoadStateParams: PageWaitForLoadStateParamsSchema,
    PageWaitForSelectorParams: PageWaitForSelectorParamsSchema,
    PageWaitForTimeoutParams: PageWaitForTimeoutParamsSchema,
    PageEvaluateParams: PageEvaluateParamsSchema,
    PageSendCDPParams: PageSendCDPParamsSchema,
    PageCloseParams: PageCloseParamsSchema,
    PageFillParams: PageFillParamsSchema,
    PageHighlightParams: PageHighlightParamsSchema,
    PageSelectOptionParams: PageSelectOptionParamsSchema,
    PageSetInputFilesParams: PageSetInputFilesParamsSchema,
    PageElementInfoParams: PageElementInfoParamsSchema,
    PageClickRequest: PageClickRequestSchema,
    PageHoverRequest: PageHoverRequestSchema,
    PageScrollRequest: PageScrollRequestSchema,
    PageDragAndDropRequest: PageDragAndDropRequestSchema,
    PageTypeRequest: PageTypeRequestSchema,
    PageKeyPressRequest: PageKeyPressRequestSchema,
    PageEnableCursorOverlayRequest: PageEnableCursorOverlayRequestSchema,
    PageAddInitScriptRequest: PageAddInitScriptRequestSchema,
    PageGotoRequest: PageGotoRequestSchema,
    PageReloadRequest: PageReloadRequestSchema,
    PageGoBackRequest: PageGoBackRequestSchema,
    PageGoForwardRequest: PageGoForwardRequestSchema,
    PageTargetIdRequest: PageTargetIdRequestSchema,
    PageMainFrameIdRequest: PageMainFrameIdRequestSchema,
    PageGetFullFrameTreeRequest: PageGetFullFrameTreeRequestSchema,
    PageListAllFrameIdsRequest: PageListAllFrameIdsRequestSchema,
    PageTitleRequest: PageTitleRequestSchema,
    PageUrlRequest: PageUrlRequestSchema,
    PageScreenshotRequest: PageScreenshotRequestSchema,
    PageSnapshotRequest: PageSnapshotRequestSchema,
    PageFramesRequest: PageFramesRequestSchema,
    PageSetViewportSizeRequest: PageSetViewportSizeRequestSchema,
    PageSetExtraHTTPHeadersRequest: PageSetExtraHTTPHeadersRequestSchema,
    PageWaitForLoadStateRequest: PageWaitForLoadStateRequestSchema,
    PageWaitForSelectorRequest: PageWaitForSelectorRequestSchema,
    PageWaitForTimeoutRequest: PageWaitForTimeoutRequestSchema,
    PageEvaluateRequest: PageEvaluateRequestSchema,
    PageSendCDPRequest: PageSendCDPRequestSchema,
    PageCloseRequest: PageCloseRequestSchema,
    PageFillRequest: PageFillRequestSchema,
    PageHighlightRequest: PageHighlightRequestSchema,
    PageSelectOptionRequest: PageSelectOptionRequestSchema,
    PageSetInputFilesRequest: PageSetInputFilesRequestSchema,
    PageElementInfoRequest: PageElementInfoRequestSchema,
    PageClickAction: PageClickActionSchema,
    PageHoverAction: PageHoverActionSchema,
    PageScrollAction: PageScrollActionSchema,
    PageDragAndDropAction: PageDragAndDropActionSchema,
    PageTypeAction: PageTypeActionSchema,
    PageKeyPressAction: PageKeyPressActionSchema,
    PageEnableCursorOverlayAction: PageEnableCursorOverlayActionSchema,
    PageAddInitScriptAction: PageAddInitScriptActionSchema,
    PageGotoAction: PageGotoActionSchema,
    PageReloadAction: PageReloadActionSchema,
    PageGoBackAction: PageGoBackActionSchema,
    PageGoForwardAction: PageGoForwardActionSchema,
    PageTargetIdAction: PageTargetIdActionSchema,
    PageMainFrameIdAction: PageMainFrameIdActionSchema,
    PageGetFullFrameTreeAction: PageGetFullFrameTreeActionSchema,
    PageListAllFrameIdsAction: PageListAllFrameIdsActionSchema,
    PageTitleAction: PageTitleActionSchema,
    PageUrlAction: PageUrlActionSchema,
    PageScreenshotAction: PageScreenshotActionSchema,
    PageSnapshotAction: PageSnapshotActionSchema,
    PageFramesAction: PageFramesActionSchema,
    PageSetViewportSizeAction: PageSetViewportSizeActionSchema,
    PageSetExtraHTTPHeadersAction: PageSetExtraHTTPHeadersActionSchema,
    PageWaitForLoadStateAction: PageWaitForLoadStateActionSchema,
    PageWaitForSelectorAction: PageWaitForSelectorActionSchema,
    PageWaitForTimeoutAction: PageWaitForTimeoutActionSchema,
    PageEvaluateAction: PageEvaluateActionSchema,
    PageSendCDPAction: PageSendCDPActionSchema,
    PageCloseAction: PageCloseActionSchema,
    PageFillAction: PageFillActionSchema,
    PageHighlightAction: PageHighlightActionSchema,
    PageSelectOptionAction: PageSelectOptionActionSchema,
    PageSetInputFilesAction: PageSetInputFilesActionSchema,
    PageElementInfoAction: PageElementInfoActionSchema,
    PageAction: PageActionSchema,
    PageClickResponse: PageClickResponseSchema,
    PageHoverResponse: PageHoverResponseSchema,
    PageScrollResponse: PageScrollResponseSchema,
    PageDragAndDropResponse: PageDragAndDropResponseSchema,
    PageTypeResponse: PageTypeResponseSchema,
    PageKeyPressResponse: PageKeyPressResponseSchema,
    PageEnableCursorOverlayResponse: PageEnableCursorOverlayResponseSchema,
    PageAddInitScriptResponse: PageAddInitScriptResponseSchema,
    PageGotoResponse: PageGotoResponseSchema,
    PageReloadResponse: PageReloadResponseSchema,
    PageGoBackResponse: PageGoBackResponseSchema,
    PageGoForwardResponse: PageGoForwardResponseSchema,
    PageTargetIdResponse: PageTargetIdResponseSchema,
    PageMainFrameIdResponse: PageMainFrameIdResponseSchema,
    PageGetFullFrameTreeResponse: PageGetFullFrameTreeResponseSchema,
    PageListAllFrameIdsResponse: PageListAllFrameIdsResponseSchema,
    PageTitleResponse: PageTitleResponseSchema,
    PageUrlResponse: PageUrlResponseSchema,
    PageScreenshotResponse: PageScreenshotResponseSchema,
    PageSnapshotResponse: PageSnapshotResponseSchema,
    PageFramesResponse: PageFramesResponseSchema,
    PageSetViewportSizeResponse: PageSetViewportSizeResponseSchema,
    PageSetExtraHTTPHeadersResponse: PageSetExtraHTTPHeadersResponseSchema,
    PageWaitForLoadStateResponse: PageWaitForLoadStateResponseSchema,
    PageWaitForSelectorResponse: PageWaitForSelectorResponseSchema,
    PageWaitForTimeoutResponse: PageWaitForTimeoutResponseSchema,
    PageEvaluateResponse: PageEvaluateResponseSchema,
    PageSendCDPResponse: PageSendCDPResponseSchema,
    PageCloseResponse: PageCloseResponseSchema,
    PageFillResult: PageFillResultSchema,
    PageFillResponse: PageFillResponseSchema,
    PageHighlightResult: PageHighlightResultSchema,
    PageHighlightResponse: PageHighlightResponseSchema,
    PageSelectOptionResult: PageSelectOptionResultSchema,
    PageSelectOptionResponse: PageSelectOptionResponseSchema,
    PageSetInputFilesResult: PageSetInputFilesResultSchema,
    PageSetInputFilesResponse: PageSetInputFilesResponseSchema,
    ElementInfoField: ElementInfoFieldSchema,
    ElementInfoVisibility: ElementInfoVisibilitySchema,
    ElementInfoDomRect: ElementInfoDomRectSchema,
    ElementInfoDomRects: ElementInfoDomRectsSchema,
    ElementInfoContent: ElementInfoContentSchema,
    ElementInfoInputInfo: ElementInfoInputInfoSchema,
    ElementInfoAriaInfo: ElementInfoAriaInfoSchema,
    ElementInfoAttributes: ElementInfoAttributesSchema,
    ElementInfoStyles: ElementInfoStylesSchema,
    PageElementInfoResult: PageElementInfoResultSchema,
    PageElementInfoResponse: PageElementInfoResponseSchema,
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
  error: z.input<typeof PageErrorSchema>;
  statusCode: number;
  stack?: string | null;
  action?: z.input<typeof PageActionSchema>;
}) {
  return V4ErrorResponseSchema.parse({
    success: false,
    error: input.error,
    statusCode: input.statusCode,
    stack: input.stack ?? null,
    ...(input.action ? { action: input.action } : {}),
  });
}
