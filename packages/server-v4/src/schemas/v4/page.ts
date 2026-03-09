import { z } from "zod/v4";

export const V4RequestIdSchema = z
  .string()
  .min(1)
  .meta({ id: "V4RequestId", example: "req_01JXAMPLE" });

export const V4ResponseIdSchema = z
  .string()
  .min(1)
  .meta({ id: "V4ResponseId", example: "req_01JXAMPLE" });

export const SessionIdSchema = z
  .string()
  .min(1)
  .meta({ id: "V4SessionId", example: "session_01JXAMPLE" });

export const PageIdSchema = z
  .string()
  .min(1)
  .meta({ id: "V4PageId", example: "target_01JXAMPLE" });

export const ActionIdSchema = z
  .string()
  .min(1)
  .meta({ id: "V4ActionId", example: "action_01JXAMPLE" });

export const TimestampSchema = z
  .string()
  .datetime()
  .meta({ id: "V4Timestamp", example: "2026-02-03T12:00:00.000Z" });

export const MouseButtonSchema = z
  .enum(["left", "right", "middle"])
  .meta({ id: "MouseButton" });

export const WaitUntilSchema = z
  .enum(["load", "domcontentloaded", "networkidle"])
  .meta({ id: "PageNavigateWaitUntil" });

export const ScreenshotTypeSchema = z
  .enum(["png", "jpeg"])
  .meta({ id: "PageScreenshotType" });

export const ScreenshotMimeTypeSchema = z
  .enum(["image/png", "image/jpeg"])
  .meta({ id: "PageScreenshotMimeType" });

export const PageActionTypeSchema = z
  .enum(["click", "scroll", "navigate", "screenshot"])
  .meta({ id: "PageActionType" });

export const PageActionStatusSchema = z
  .enum(["queued", "running", "completed", "failed", "canceled"])
  .meta({ id: "PageActionStatus" });

export const PageSelectorSchema = z
  .object({
    xpath: z.string().min(1).meta({
      description: "Absolute or relative XPath understood by understudy.",
      example: "//button[text()='Submit']",
    }),
  })
  .strict()
  .meta({ id: "PageSelector" });

export const ResponseMetadataSchema = z
  .object({
    requestId: z.string().min(1),
    sessionId: SessionIdSchema.optional(),
    pageId: PageIdSchema.optional(),
    actionId: ActionIdSchema.optional(),
    timestamp: TimestampSchema,
  })
  .strict()
  .meta({ id: "V4ResponseMetadata" });

export const ErrorObjectSchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
  .meta({ id: "V4ErrorObject" });

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

const createSuccessResponseSchema = <T extends z.ZodTypeAny>(
  resultSchema: T,
  id: string,
) =>
  z
    .object({
      id: V4ResponseIdSchema,
      error: z.null(),
      result: resultSchema,
      metadata: ResponseMetadataSchema,
    })
    .strict()
    .meta({ id });

const createErrorResponseSchema = (id: string) =>
  z
    .object({
      id: V4ResponseIdSchema,
      error: ErrorObjectSchema,
      result: z.null(),
      metadata: ResponseMetadataSchema,
    })
    .strict()
    .meta({ id });

const createCommandRequestSchema = <T extends z.ZodTypeAny>(
  paramsSchema: T,
  id: string,
) =>
  z
    .object({
      id: V4RequestIdSchema.optional(),
      sessionId: SessionIdSchema,
      params: paramsSchema,
    })
    .strict()
    .meta({ id });

export const PageClickParamsSchema = z
  .object({
    pageId: PageIdSchema.optional(),
    selector: PageSelectorSchema,
    button: MouseButtonSchema.optional(),
    clickCount: z
      .number()
      .int()
      .min(1)
      .max(3)
      .optional()
      .meta({ description: "Defaults to a single click." }),
  })
  .strict()
  .meta({ id: "PageClickParams" });

export const PageScrollByCoordinatesParamsSchema = z
  .object({
    target: z.literal("coordinates"),
    pageId: PageIdSchema.optional(),
    x: z.number(),
    y: z.number(),
    deltaX: z.number().optional(),
    deltaY: z.number(),
  })
  .strict()
  .meta({ id: "PageScrollByCoordinatesParams" });

export const PageScrollBySelectorParamsSchema = z
  .object({
    target: z.literal("selector"),
    pageId: PageIdSchema.optional(),
    selector: PageSelectorSchema,
    percentage: z.number().min(0).max(100),
  })
  .strict()
  .meta({ id: "PageScrollBySelectorParams" });

export const PageScrollParamsSchema = z
  .discriminatedUnion("target", [
    PageScrollByCoordinatesParamsSchema,
    PageScrollBySelectorParamsSchema,
  ])
  .meta({ id: "PageScrollParams" });

export const PageNavigateParamsSchema = z
  .object({
    pageId: PageIdSchema.optional(),
    url: z.string().url(),
    referer: z.string().url().optional(),
    waitUntil: WaitUntilSchema.optional(),
    timeoutMs: z.number().int().positive().optional(),
  })
  .strict()
  .meta({ id: "PageNavigateParams" });

export const PageScreenshotParamsSchema = z
  .object({
    pageId: PageIdSchema.optional(),
    fullPage: z.boolean().optional(),
    type: ScreenshotTypeSchema.optional(),
    quality: z.number().int().min(0).max(100).optional(),
    timeoutMs: z.number().int().positive().optional(),
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
  })
  .meta({ id: "PageScreenshotParams" });

export const PageClickRequestSchema = createCommandRequestSchema(
  PageClickParamsSchema,
  "PageClickRequest",
);

export const PageScrollRequestSchema = createCommandRequestSchema(
  PageScrollParamsSchema,
  "PageScrollRequest",
);

export const PageNavigateRequestSchema = createCommandRequestSchema(
  PageNavigateParamsSchema,
  "PageNavigateRequest",
);

export const PageScreenshotRequestSchema = createCommandRequestSchema(
  PageScreenshotParamsSchema,
  "PageScreenshotRequest",
);

export const PageActionIdParamsSchema = z
  .object({
    actionId: ActionIdSchema,
  })
  .strict()
  .meta({ id: "PageActionIdParams" });

export const PageActionDetailsQuerySchema = z
  .object({
    id: V4RequestIdSchema.optional(),
    sessionId: SessionIdSchema,
  })
  .strict()
  .meta({ id: "PageActionDetailsQuery" });

export const PageActionListQuerySchema = z
  .object({
    id: V4RequestIdSchema.optional(),
    sessionId: SessionIdSchema,
    pageId: PageIdSchema.optional(),
    type: PageActionTypeSchema.optional(),
    status: PageActionStatusSchema.optional(),
    limit: z.coerce.number().int().positive().max(500).optional(),
  })
  .strict()
  .meta({ id: "PageActionListQuery" });

export const PageClickResultDataSchema = z
  .object({
    clicked: z.boolean(),
    selector: PageSelectorSchema,
  })
  .strict()
  .meta({ id: "PageClickResultData" });

export const PageScrollByCoordinatesResultDataSchema = z
  .object({
    target: z.literal("coordinates"),
    x: z.number(),
    y: z.number(),
    deltaX: z.number(),
    deltaY: z.number(),
  })
  .strict()
  .meta({ id: "PageScrollByCoordinatesResultData" });

export const PageScrollBySelectorResultDataSchema = z
  .object({
    target: z.literal("selector"),
    selector: PageSelectorSchema,
    percentage: z.number().min(0).max(100),
  })
  .strict()
  .meta({ id: "PageScrollBySelectorResultData" });

export const PageScrollResultDataSchema = z
  .discriminatedUnion("target", [
    PageScrollByCoordinatesResultDataSchema,
    PageScrollBySelectorResultDataSchema,
  ])
  .meta({ id: "PageScrollResultData" });

export const PageNavigateResultDataSchema = z
  .object({
    url: z.string().url(),
  })
  .strict()
  .meta({ id: "PageNavigateResultData" });

export const PageScreenshotResultDataSchema = z
  .object({
    base64: z.string(),
    mimeType: ScreenshotMimeTypeSchema,
  })
  .strict()
  .meta({ id: "PageScreenshotResultData" });

export const PageActionBaseSchema = z
  .object({
    id: ActionIdSchema,
    status: PageActionStatusSchema,
    sessionId: SessionIdSchema,
    pageId: PageIdSchema.optional(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    completedAt: TimestampSchema.optional(),
    error: ErrorObjectSchema.nullable(),
  })
  .strict()
  .meta({ id: "PageActionBase" });

export const PageClickActionSchema = PageActionBaseSchema.extend({
  type: z.literal("click"),
  request: PageClickParamsSchema,
  resultData: PageClickResultDataSchema.nullable(),
}).meta({ id: "PageClickAction" });

export const PageScrollActionSchema = PageActionBaseSchema.extend({
  type: z.literal("scroll"),
  request: PageScrollParamsSchema,
  resultData: PageScrollResultDataSchema.nullable(),
}).meta({ id: "PageScrollAction" });

export const PageNavigateActionSchema = PageActionBaseSchema.extend({
  type: z.literal("navigate"),
  request: PageNavigateParamsSchema,
  resultData: PageNavigateResultDataSchema.nullable(),
}).meta({ id: "PageNavigateAction" });

export const PageScreenshotActionSchema = PageActionBaseSchema.extend({
  type: z.literal("screenshot"),
  request: PageScreenshotParamsSchema,
  resultData: PageScreenshotResultDataSchema.nullable(),
}).meta({ id: "PageScreenshotAction" });

export const PageActionSchema = z
  .discriminatedUnion("type", [
    PageClickActionSchema,
    PageScrollActionSchema,
    PageNavigateActionSchema,
    PageScreenshotActionSchema,
  ])
  .meta({ id: "PageAction" });

export const PageClickResultSchema = z
  .object({
    action: PageClickActionSchema,
  })
  .strict()
  .meta({ id: "PageClickResult" });

export const PageScrollResultSchema = z
  .object({
    action: PageScrollActionSchema,
  })
  .strict()
  .meta({ id: "PageScrollResult" });

export const PageNavigateResultSchema = z
  .object({
    action: PageNavigateActionSchema,
  })
  .strict()
  .meta({ id: "PageNavigateResult" });

export const PageScreenshotResultSchema = z
  .object({
    action: PageScreenshotActionSchema,
  })
  .strict()
  .meta({ id: "PageScreenshotResult" });

export const PageActionDetailsResultSchema = z
  .object({
    action: PageActionSchema,
  })
  .strict()
  .meta({ id: "PageActionDetailsResult" });

export const PageActionListResultSchema = z
  .object({
    actions: z.array(PageActionSchema),
  })
  .strict()
  .meta({ id: "PageActionListResult" });

export const PageClickResponseSchema = createSuccessResponseSchema(
  PageClickResultSchema,
  "PageClickResponse",
);

export const PageScrollResponseSchema = createSuccessResponseSchema(
  PageScrollResultSchema,
  "PageScrollResponse",
);

export const PageNavigateResponseSchema = createSuccessResponseSchema(
  PageNavigateResultSchema,
  "PageNavigateResponse",
);

export const PageScreenshotResponseSchema = createSuccessResponseSchema(
  PageScreenshotResultSchema,
  "PageScreenshotResponse",
);

export const PageActionDetailsResponseSchema = createSuccessResponseSchema(
  PageActionDetailsResultSchema,
  "PageActionDetailsResponse",
);

export const PageActionListResponseSchema = createSuccessResponseSchema(
  PageActionListResultSchema,
  "PageActionListResponse",
);

export const V4ErrorResponseSchema = createErrorResponseSchema(
  "V4ErrorResponse",
);

export const PageOperations = {
  PageClick: {
    operationId: "PageClick",
    summary: "Click an element on the current page",
    description:
      "Creates a page action that clicks an element addressed by an understudy XPath selector.",
    tags: ["Page"],
  },
  PageScroll: {
    operationId: "PageScroll",
    summary: "Scroll the current page",
    description:
      "Creates a page action that either scrolls by coordinates or scrolls a selected element to a percentage.",
    tags: ["Page"],
  },
  PageNavigate: {
    operationId: "PageNavigate",
    summary: "Navigate a page",
    description: "Creates a page action that navigates the selected page to a URL.",
    tags: ["Page"],
  },
  PageScreenshot: {
    operationId: "PageScreenshot",
    summary: "Capture a screenshot",
    description:
      "Creates a page action that captures a screenshot and returns the image as raw base64 data.",
    tags: ["Page"],
  },
  PageActionDetails: {
    operationId: "PageActionDetails",
    summary: "Get page action details",
    description: "Retrieves a previously recorded page action by ID.",
    tags: ["Page"],
  },
  PageActionList: {
    operationId: "PageActionList",
    summary: "List page actions",
    description: "Lists previously recorded page actions for a session.",
    tags: ["Page"],
  },
} as const;

export const pageOpenApiComponents = {
  schemas: {
    V4RequestId: V4RequestIdSchema,
    V4ResponseId: V4ResponseIdSchema,
    V4SessionId: SessionIdSchema,
    V4PageId: PageIdSchema,
    V4ActionId: ActionIdSchema,
    V4Timestamp: TimestampSchema,
    MouseButton: MouseButtonSchema,
    PageNavigateWaitUntil: WaitUntilSchema,
    PageScreenshotType: ScreenshotTypeSchema,
    PageScreenshotMimeType: ScreenshotMimeTypeSchema,
    PageActionType: PageActionTypeSchema,
    PageActionStatus: PageActionStatusSchema,
    PageSelector: PageSelectorSchema,
    V4ResponseMetadata: ResponseMetadataSchema,
    V4ErrorObject: ErrorObjectSchema,
    ValidationErrorResponse: ValidationErrorResponseSchema,
    PageClickParams: PageClickParamsSchema,
    PageScrollByCoordinatesParams: PageScrollByCoordinatesParamsSchema,
    PageScrollBySelectorParams: PageScrollBySelectorParamsSchema,
    PageScrollParams: PageScrollParamsSchema,
    PageNavigateParams: PageNavigateParamsSchema,
    PageScreenshotParams: PageScreenshotParamsSchema,
    PageClickRequest: PageClickRequestSchema,
    PageScrollRequest: PageScrollRequestSchema,
    PageNavigateRequest: PageNavigateRequestSchema,
    PageScreenshotRequest: PageScreenshotRequestSchema,
    PageActionIdParams: PageActionIdParamsSchema,
    PageActionDetailsQuery: PageActionDetailsQuerySchema,
    PageActionListQuery: PageActionListQuerySchema,
    PageClickResultData: PageClickResultDataSchema,
    PageScrollByCoordinatesResultData: PageScrollByCoordinatesResultDataSchema,
    PageScrollBySelectorResultData: PageScrollBySelectorResultDataSchema,
    PageScrollResultData: PageScrollResultDataSchema,
    PageNavigateResultData: PageNavigateResultDataSchema,
    PageScreenshotResultData: PageScreenshotResultDataSchema,
    PageActionBase: PageActionBaseSchema,
    PageClickAction: PageClickActionSchema,
    PageScrollAction: PageScrollActionSchema,
    PageNavigateAction: PageNavigateActionSchema,
    PageScreenshotAction: PageScreenshotActionSchema,
    PageAction: PageActionSchema,
    PageClickResult: PageClickResultSchema,
    PageScrollResult: PageScrollResultSchema,
    PageNavigateResult: PageNavigateResultSchema,
    PageScreenshotResult: PageScreenshotResultSchema,
    PageActionDetailsResult: PageActionDetailsResultSchema,
    PageActionListResult: PageActionListResultSchema,
    PageClickResponse: PageClickResponseSchema,
    PageScrollResponse: PageScrollResponseSchema,
    PageNavigateResponse: PageNavigateResponseSchema,
    PageScreenshotResponse: PageScreenshotResponseSchema,
    PageActionDetailsResponse: PageActionDetailsResponseSchema,
    PageActionListResponse: PageActionListResponseSchema,
    V4ErrorResponse: V4ErrorResponseSchema,
  },
} as const;

export type PageActionType = z.infer<typeof PageActionTypeSchema>;
export type PageActionStatus = z.infer<typeof PageActionStatusSchema>;
export type PageSelector = z.infer<typeof PageSelectorSchema>;
export type ResponseMetadata = z.infer<typeof ResponseMetadataSchema>;
export type ErrorObject = z.infer<typeof ErrorObjectSchema>;
export type PageClickParams = z.infer<typeof PageClickParamsSchema>;
export type PageScrollParams = z.infer<typeof PageScrollParamsSchema>;
export type PageNavigateParams = z.infer<typeof PageNavigateParamsSchema>;
export type PageScreenshotParams = z.infer<typeof PageScreenshotParamsSchema>;
export type PageClickRequest = z.infer<typeof PageClickRequestSchema>;
export type PageScrollRequest = z.infer<typeof PageScrollRequestSchema>;
export type PageNavigateRequest = z.infer<typeof PageNavigateRequestSchema>;
export type PageScreenshotRequest = z.infer<
  typeof PageScreenshotRequestSchema
>;
export type PageActionDetailsQuery = z.infer<
  typeof PageActionDetailsQuerySchema
>;
export type PageActionListQuery = z.infer<typeof PageActionListQuerySchema>;
export type PageAction = z.infer<typeof PageActionSchema>;
export type PageClickAction = z.infer<typeof PageClickActionSchema>;
export type PageScrollAction = z.infer<typeof PageScrollActionSchema>;
export type PageNavigateAction = z.infer<typeof PageNavigateActionSchema>;
export type PageScreenshotAction = z.infer<typeof PageScreenshotActionSchema>;
export type V4ErrorResponse = z.infer<typeof V4ErrorResponseSchema>;

export function buildResponseMetadata(
  input: Omit<ResponseMetadata, "timestamp"> & { timestamp?: string },
): ResponseMetadata {
  return {
    ...input,
    timestamp: input.timestamp ?? new Date().toISOString(),
  };
}

export function buildErrorResponse(input: {
  id: string;
  error: ErrorObject;
  metadata: Omit<ResponseMetadata, "timestamp"> & { timestamp?: string };
}): V4ErrorResponse {
  return {
    id: input.id,
    error: input.error,
    result: null,
    metadata: buildResponseMetadata(input.metadata),
  };
}
