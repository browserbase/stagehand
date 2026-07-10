import { createRpcSchemas } from "./json-rpc/schemas.ts";
import {
  ActResultSchema,
  ContextNewPageParamsSchema,
  ContextPagesResultSchema,
  EmptyParamsSchema,
  ExtractResultSchema,
  LocatorClickParamsSchema,
  LocatorClickResultSchema,
  LocatorDescriptorSchema,
  LocatorFillParamsSchema,
  LocatorFillResultSchema,
  LocatorIsVisibleResultSchema,
  LocatorTextContentResultSchema,
  ObserveResultSchema,
  PageCloseResultSchema,
  PageGotoParamsSchema,
  PageIdParamsSchema,
  PageRefSchema,
  PageTitleResultSchema,
  PageUrlResultSchema,
  StagehandActParamsSchema,
  StagehandCloseResultSchema,
  StagehandExtractParamsSchema,
  StagehandInitParamsSchema,
  StagehandInitResultSchema,
  StagehandLogEventSchema,
  StagehandMetricsSchema,
  StagehandObserveParamsSchema,
  StagehandPingResultSchema,
} from "./schemas.ts";

export const StagehandMethods = {
  ping: {
    paramsSchema: EmptyParamsSchema,
    resultSchema: StagehandPingResultSchema,
  },
  "stagehand.init": {
    paramsSchema: StagehandInitParamsSchema,
    resultSchema: StagehandInitResultSchema,
  },
  "stagehand.close": {
    paramsSchema: EmptyParamsSchema,
    resultSchema: StagehandCloseResultSchema,
  },
  "stagehand.act": {
    paramsSchema: StagehandActParamsSchema,
    resultSchema: ActResultSchema,
  },
  "stagehand.observe": {
    paramsSchema: StagehandObserveParamsSchema,
    resultSchema: ObserveResultSchema,
  },
  "stagehand.extract": {
    paramsSchema: StagehandExtractParamsSchema,
    resultSchema: ExtractResultSchema,
    resultWire: {
      decode: { opaqueKeys: ["result"] },
      encode: { opaqueKeys: ["result"] },
    },
  },
  "stagehand.metrics": {
    paramsSchema: EmptyParamsSchema,
    resultSchema: StagehandMetricsSchema,
  },
  "context.pages": {
    paramsSchema: EmptyParamsSchema,
    resultSchema: ContextPagesResultSchema,
  },
  "context.new_page": {
    paramsSchema: ContextNewPageParamsSchema,
    resultSchema: PageRefSchema,
  },
  "page.goto": {
    paramsSchema: PageGotoParamsSchema,
    resultSchema: PageRefSchema,
  },
  "page.url": {
    paramsSchema: PageIdParamsSchema,
    resultSchema: PageUrlResultSchema,
  },
  "page.title": {
    paramsSchema: PageIdParamsSchema,
    resultSchema: PageTitleResultSchema,
  },
  "page.close": {
    paramsSchema: PageIdParamsSchema,
    resultSchema: PageCloseResultSchema,
  },
  "locator.click": {
    paramsSchema: LocatorClickParamsSchema,
    resultSchema: LocatorClickResultSchema,
  },
  "locator.fill": {
    paramsSchema: LocatorFillParamsSchema,
    resultSchema: LocatorFillResultSchema,
  },
  "locator.is_visible": {
    paramsSchema: LocatorDescriptorSchema,
    resultSchema: LocatorIsVisibleResultSchema,
  },
  "locator.text_content": {
    paramsSchema: LocatorDescriptorSchema,
    resultSchema: LocatorTextContentResultSchema,
  },
} as const;

export const StagehandNotifications = {
  "stagehand.log_event": {
    paramsSchema: StagehandLogEventSchema,
  },
} as const;

const stagehandRpcSchemas = createRpcSchemas(StagehandMethods, StagehandNotifications);

export const StagehandRpcRequestSchema = stagehandRpcSchemas.requestSchema;
export const StagehandRpcNotificationSchema = stagehandRpcSchemas.notificationSchema;
