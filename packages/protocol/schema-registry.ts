import { z } from "zod/v4";
import {
  JSONRPCNotificationSchema,
  JSONRPCRequestSchema,
  type RPCMethod,
  type RPCNotification,
} from "./json-rpc/schemas.ts";
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

export const STAGEHAND_SEND_TO_HOST_BINDING = "__stagehandSendToHost";
export const StagehandSendToHostBindingSchema = z.literal(STAGEHAND_SEND_TO_HOST_BINDING);

export const StagehandRPC = {
  ping: { name: "ping", params: EmptyParamsSchema, result: StagehandPingResultSchema },
  runtimeConfigure: {
    name: "runtime.configure",
    params: RuntimeConfigureParamsSchema,
    result: RuntimeConfigureResultSchema,
  },
  runtimeLoopbackStatus: {
    name: "runtime.loopback_status",
    params: EmptyParamsSchema,
    result: RuntimeLoopbackStatusResultSchema,
  },
  browserGetVersion: {
    name: "browser.get_version",
    params: EmptyParamsSchema,
    result: BrowserGetVersionResultSchema,
  },
  stagehandInit: {
    name: "stagehand.init",
    params: StagehandInitParamsSchema,
    result: StagehandInitResultSchema,
  },
  stagehandClose: {
    name: "stagehand.close",
    params: EmptyParamsSchema,
    result: StagehandCloseResultSchema,
  },
  stagehandAct: {
    name: "stagehand.act",
    params: StagehandActParamsSchema,
    result: ActResultSchema,
  },
  stagehandObserve: {
    name: "stagehand.observe",
    params: StagehandObserveParamsSchema,
    result: ObserveResultSchema,
  },
  stagehandExtract: {
    name: "stagehand.extract",
    params: StagehandExtractParamsSchema,
    result: ExtractResultSchema,
    resultWire: {
      decode: { opaqueKeys: ["result"] },
      encode: { opaqueKeys: ["result"] },
    },
  },
  stagehandMetrics: {
    name: "stagehand.metrics",
    params: EmptyParamsSchema,
    result: StagehandMetricsSchema,
  },
  contextPages: {
    name: "context.pages",
    params: EmptyParamsSchema,
    result: ContextPagesResultSchema,
  },
  contextNewPage: {
    name: "context.new_page",
    params: ContextNewPageParamsSchema,
    result: PageRefSchema,
  },
  pageGoto: { name: "page.goto", params: PageGotoParamsSchema, result: PageRefSchema },
  pageUrl: { name: "page.url", params: PageIdParamsSchema, result: PageUrlResultSchema },
  pageTitle: { name: "page.title", params: PageIdParamsSchema, result: PageTitleResultSchema },
  pageClose: { name: "page.close", params: PageIdParamsSchema, result: PageCloseResultSchema },
  locatorClick: {
    name: "locator.click",
    params: LocatorClickParamsSchema,
    result: LocatorClickResultSchema,
  },
  locatorFill: {
    name: "locator.fill",
    params: LocatorFillParamsSchema,
    result: LocatorFillResultSchema,
  },
  locatorHover: {
    name: "locator.hover",
    params: LocatorHoverParamsSchema,
    result: LocatorHoverResultSchema,
  },
  locatorCount: {
    name: "locator.count",
    params: LocatorCountParamsSchema,
    result: LocatorCountResultSchema,
  },
  locatorIsChecked: {
    name: "locator.is_checked",
    params: LocatorIsCheckedParamsSchema,
    result: LocatorIsCheckedResultSchema,
  },
  locatorInputValue: {
    name: "locator.input_value",
    params: LocatorInputValueParamsSchema,
    result: LocatorInputValueResultSchema,
  },
  locatorIsVisible: {
    name: "locator.is_visible",
    params: LocatorDescriptorSchema,
    result: LocatorIsVisibleResultSchema,
  },
  locatorInnerText: {
    name: "locator.inner_text",
    params: LocatorInnerTextParamsSchema,
    result: LocatorInnerTextResultSchema,
  },
  locatorInnerHtml: {
    name: "locator.inner_html",
    params: LocatorInnerHtmlParamsSchema,
    result: LocatorInnerHtmlResultSchema,
  },
  locatorTextContent: {
    name: "locator.text_content",
    params: LocatorDescriptorSchema,
    result: LocatorTextContentResultSchema,
  },
  locatorScrollTo: {
    name: "locator.scroll_to",
    params: LocatorScrollToParamsSchema,
    result: LocatorScrollToResultSchema,
  },
  locatorCentroid: {
    name: "locator.centroid",
    params: LocatorCentroidParamsSchema,
    result: LocatorCentroidResultSchema,
  },
  locatorHighlight: {
    name: "locator.highlight",
    params: LocatorHighlightParamsSchema,
    result: LocatorHighlightResultSchema,
  },
  locatorSendClickEvent: {
    name: "locator.send_click_event",
    params: LocatorSendClickEventParamsSchema,
    result: LocatorSendClickEventResultSchema,
  },
  locatorType: {
    name: "locator.type",
    params: LocatorTypeParamsSchema,
    result: LocatorTypeResultSchema,
  },
  locatorSelectOption: {
    name: "locator.select_option",
    params: LocatorSelectOptionParamsSchema,
    result: LocatorSelectOptionResultSchema,
  },
} as const satisfies Record<string, RPCMethod>;

export const StagehandMethodSchema = z.enum(
  Object.values(StagehandRPC).map((method) => method.name),
);

export const StagehandRpcRequestSchema = JSONRPCRequestSchema.extend({
  method: StagehandMethodSchema,
  params: z.record(z.string(), z.json()),
});

export const StagehandNotifications = {
  log: { name: "stagehand.log", params: StagehandLogSchema },
} as const satisfies Record<string, RPCNotification>;

export const StagehandRpcNotificationSchema = JSONRPCNotificationSchema.extend({
  method: z.literal(StagehandNotifications.log.name),
  params: StagehandLogSchema,
});

const stagehandMethodsByName = new Map<string, RPCMethod>(
  Object.values(StagehandRPC).map((method) => [method.name, method]),
);

export function getStagehandRPCMethod(name: string): RPCMethod | undefined {
  return stagehandMethodsByName.get(name);
}
