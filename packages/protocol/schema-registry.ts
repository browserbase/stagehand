import { createRpcSchemas } from "./json-rpc/schemas.ts";
import { z } from "zod/v4";
import {
  ActResultSchema,
  BrowserGetVersionResultSchema,
  ContextNewPageParamsSchema,
  ContextPagesResultSchema,
  EmptyParamsSchema,
  ExtractResultSchema,
  LocatorClickParamsSchema,
  LocatorClickResultSchema,
  LocatorCentroidParamsSchema,
  LocatorCentroidResultSchema,
  LocatorCountParamsSchema,
  LocatorCountResultSchema,
  LocatorDescriptorSchema,
  LocatorFillParamsSchema,
  LocatorFillResultSchema,
  LocatorHighlightParamsSchema,
  LocatorHighlightResultSchema,
  LocatorHoverParamsSchema,
  LocatorHoverResultSchema,
  LocatorInnerHtmlParamsSchema,
  LocatorInnerHtmlResultSchema,
  LocatorInnerTextParamsSchema,
  LocatorInnerTextResultSchema,
  LocatorInputValueParamsSchema,
  LocatorInputValueResultSchema,
  LocatorIsCheckedParamsSchema,
  LocatorIsCheckedResultSchema,
  LocatorIsVisibleResultSchema,
  LocatorScrollToParamsSchema,
  LocatorScrollToResultSchema,
  LocatorSelectOptionParamsSchema,
  LocatorSelectOptionResultSchema,
  LocatorSendClickEventParamsSchema,
  LocatorSendClickEventResultSchema,
  LocatorTextContentResultSchema,
  LocatorTypeParamsSchema,
  LocatorTypeResultSchema,
  ObserveResultSchema,
  PageCloseResultSchema,
  PageGotoParamsSchema,
  PageIdParamsSchema,
  PageRefSchema,
  PageTitleResultSchema,
  PageUrlResultSchema,
  RuntimeConfigureParamsSchema,
  RuntimeConfigureResultSchema,
  RuntimeLoopbackStatusResultSchema,
  StagehandActParamsSchema,
  StagehandCloseResultSchema,
  StagehandExtractParamsSchema,
  StagehandInitParamsSchema,
  StagehandInitResultSchema,
  StagehandLogSchema,
  StagehandMetricsSchema,
  StagehandObserveParamsSchema,
  StagehandPingResultSchema,
} from "./schemas.ts";

export const STAGEHAND_NOTIFICATION_BINDING_NAME = "__stagehand_emit_notification";

export const StagehandMethods = {
  ping: {
    paramsSchema: EmptyParamsSchema,
    resultSchema: StagehandPingResultSchema,
  },
  "runtime.configure": {
    paramsSchema: RuntimeConfigureParamsSchema,
    resultSchema: RuntimeConfigureResultSchema,
  },
  "runtime.loopback_status": {
    paramsSchema: EmptyParamsSchema,
    resultSchema: RuntimeLoopbackStatusResultSchema,
  },
  "browser.get_version": {
    paramsSchema: EmptyParamsSchema,
    resultSchema: BrowserGetVersionResultSchema,
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
  "locator.hover": {
    paramsSchema: LocatorHoverParamsSchema,
    resultSchema: LocatorHoverResultSchema,
  },
  "locator.count": {
    paramsSchema: LocatorCountParamsSchema,
    resultSchema: LocatorCountResultSchema,
  },
  "locator.is_checked": {
    paramsSchema: LocatorIsCheckedParamsSchema,
    resultSchema: LocatorIsCheckedResultSchema,
  },
  "locator.input_value": {
    paramsSchema: LocatorInputValueParamsSchema,
    resultSchema: LocatorInputValueResultSchema,
  },
  "locator.is_visible": {
    paramsSchema: LocatorDescriptorSchema,
    resultSchema: LocatorIsVisibleResultSchema,
  },
  "locator.inner_text": {
    paramsSchema: LocatorInnerTextParamsSchema,
    resultSchema: LocatorInnerTextResultSchema,
  },
  "locator.inner_html": {
    paramsSchema: LocatorInnerHtmlParamsSchema,
    resultSchema: LocatorInnerHtmlResultSchema,
  },
  "locator.text_content": {
    paramsSchema: LocatorDescriptorSchema,
    resultSchema: LocatorTextContentResultSchema,
  },
  "locator.scroll_to": {
    paramsSchema: LocatorScrollToParamsSchema,
    resultSchema: LocatorScrollToResultSchema,
  },
  "locator.centroid": {
    paramsSchema: LocatorCentroidParamsSchema,
    resultSchema: LocatorCentroidResultSchema,
  },
  "locator.highlight": {
    paramsSchema: LocatorHighlightParamsSchema,
    resultSchema: LocatorHighlightResultSchema,
  },
  "locator.send_click_event": {
    paramsSchema: LocatorSendClickEventParamsSchema,
    resultSchema: LocatorSendClickEventResultSchema,
  },
  "locator.type": {
    paramsSchema: LocatorTypeParamsSchema,
    resultSchema: LocatorTypeResultSchema,
  },
  "locator.select_option": {
    paramsSchema: LocatorSelectOptionParamsSchema,
    resultSchema: LocatorSelectOptionResultSchema,
  },
} as const;

export const StagehandNotificationsSchema = z.strictObject({
  "stagehand.log": StagehandLogSchema,
});

const stagehandRpcSchemas = createRpcSchemas(StagehandMethods, StagehandNotificationsSchema);

export const StagehandRpcRequestSchema = stagehandRpcSchemas.requestSchema;
export const StagehandRpcNotificationSchema = stagehandRpcSchemas.notificationSchema;
