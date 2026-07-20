import { z } from "zod/v4";
import {
  JSONRPCNotificationSchema,
  JSONRPCRequestSchema,
  type RPCMethod,
  type RPCNotification,
} from "./json-rpc/schemas.ts";
import { wireSchema } from "./json-rpc/wire-casing.ts";
import {
  ActResultSchema,
  BrowserGetVersionResultSchema,
  ContextActivePageResultSchema,
  ContextAddCookiesParamsSchema,
  ContextAddInitScriptParamsSchema,
  ContextClearCookiesParamsSchema,
  ContextClipboardClearParamsSchema,
  ContextClipboardCopyParamsSchema,
  ContextClipboardCutParamsSchema,
  ContextClipboardPasteParamsSchema,
  ContextClipboardReadTextParamsSchema,
  ContextClipboardReadTextResultSchema,
  ContextClipboardWriteTextParamsSchema,
  ContextCloseResultSchema,
  ContextCookiesParamsSchema,
  ContextCookiesResultSchema,
  ContextGetDomainPolicyResultSchema,
  ContextNewPageParamsSchema,
  ContextPagesResultSchema,
  ContextSetActivePageParamsSchema,
  ContextSetDomainPolicyParamsSchema,
  ContextSetExtraHTTPHeadersParamsSchema,
  ContextVoidResultSchema,
  EmptyParamsSchema,
  ExtractResultSchema,
  LocatorClickParamsSchema,
  LocatorClickResultSchema,
  LocatorCentroidResultSchema,
  LocatorCountResultSchema,
  LocatorDescriptorSchema,
  LocatorFillParamsSchema,
  LocatorFillResultSchema,
  LocatorHighlightParamsSchema,
  LocatorHighlightResultSchema,
  LocatorHoverResultSchema,
  LocatorInnerHtmlResultSchema,
  LocatorInnerTextResultSchema,
  LocatorInputValueResultSchema,
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
  LLMGenerateParamsSchema,
  LLMGenerateResultSchema,
  ObserveResultSchema,
  PageAddInitScriptParamsSchema,
  PageClickParamsSchema,
  PageCloseResultSchema,
  PageCoordinateResultSchema,
  PageDragAndDropParamsSchema,
  PageDragAndDropResultSchema,
  PageEvaluateParamsSchema,
  PageEvaluateResultSchema,
  PageGoBackParamsSchema,
  PageGoForwardParamsSchema,
  PageGotoParamsSchema,
  PageHoverParamsSchema,
  PageIdParamsSchema,
  PageKeyPressParamsSchema,
  PageRefSchema,
  PageReloadParamsSchema,
  PageScreenshotParamsSchema,
  PageScreenshotResultSchema,
  PageScrollParamsSchema,
  PageSetExtraHTTPHeadersParamsSchema,
  PageSetViewportSizeParamsSchema,
  PageSnapshotParamsSchema,
  PageTitleResultSchema,
  PageTypeParamsSchema,
  PageUrlResultSchema,
  PageVoidResultSchema,
  PageWaitForLoadStateParamsSchema,
  PageWaitForSelectorParamsSchema,
  PageWaitForSelectorResultSchema,
  PageWaitForTimeoutParamsSchema,
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
  SnapshotResultSchema,
} from "./schemas.ts";

export const STAGEHAND_SEND_TO_HOST_BINDING = "__stagehandSendToHost";
export const StagehandSendToHostBindingSchema = z.literal(STAGEHAND_SEND_TO_HOST_BINDING);

export const StagehandMethods = {
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
    paramsWire: { opaqueKeys: ["schema"] },
    resultWire: { opaqueKeys: ["result"] },
  },
  stagehandMetrics: {
    name: "stagehand.metrics",
    params: EmptyParamsSchema,
    result: StagehandMetricsSchema,
  },
  llmGenerate: {
    name: "llm.generate",
    params: LLMGenerateParamsSchema,
    result: LLMGenerateResultSchema,
    paramsWire: {
      opaqueKeys: ["inputSchema", "outputSchema", "input", "structuredContent", "schema"],
    },
    resultWire: { opaqueKeys: ["structuredContent"] },
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
  contextActivePage: {
    name: "context.active_page",
    params: EmptyParamsSchema,
    result: ContextActivePageResultSchema,
  },
  contextSetActivePage: {
    name: "context.set_active_page",
    params: ContextSetActivePageParamsSchema,
    result: ContextVoidResultSchema,
  },
  contextClose: {
    name: "context.close",
    params: EmptyParamsSchema,
    result: ContextCloseResultSchema,
  },
  contextAddInitScript: {
    name: "context.add_init_script",
    params: ContextAddInitScriptParamsSchema,
    result: ContextVoidResultSchema,
  },
  contextSetExtraHTTPHeaders: {
    name: "context.set_extra_http_headers",
    params: ContextSetExtraHTTPHeadersParamsSchema,
    result: ContextVoidResultSchema,
    paramsWire: { opaqueKeys: ["headers"] },
  },
  contextGetDomainPolicy: {
    name: "context.get_domain_policy",
    params: EmptyParamsSchema,
    result: ContextGetDomainPolicyResultSchema,
  },
  contextSetDomainPolicy: {
    name: "context.set_domain_policy",
    params: ContextSetDomainPolicyParamsSchema,
    result: ContextVoidResultSchema,
  },
  contextCookies: {
    name: "context.cookies",
    params: ContextCookiesParamsSchema,
    result: ContextCookiesResultSchema,
  },
  contextAddCookies: {
    name: "context.add_cookies",
    params: ContextAddCookiesParamsSchema,
    result: ContextVoidResultSchema,
  },
  contextClearCookies: {
    name: "context.clear_cookies",
    params: ContextClearCookiesParamsSchema,
    result: ContextVoidResultSchema,
  },
  contextClipboardReadText: {
    name: "context.clipboard_read_text",
    params: ContextClipboardReadTextParamsSchema,
    result: ContextClipboardReadTextResultSchema,
  },
  contextClipboardWriteText: {
    name: "context.clipboard_write_text",
    params: ContextClipboardWriteTextParamsSchema,
    result: ContextVoidResultSchema,
  },
  contextClipboardClear: {
    name: "context.clipboard_clear",
    params: ContextClipboardClearParamsSchema,
    result: ContextVoidResultSchema,
  },
  contextClipboardPaste: {
    name: "context.clipboard_paste",
    params: ContextClipboardPasteParamsSchema,
    result: ContextVoidResultSchema,
  },
  contextClipboardCopy: {
    name: "context.clipboard_copy",
    params: ContextClipboardCopyParamsSchema,
    result: ContextVoidResultSchema,
  },
  contextClipboardCut: {
    name: "context.clipboard_cut",
    params: ContextClipboardCutParamsSchema,
    result: ContextVoidResultSchema,
  },
  pageGoto: { name: "page.goto", params: PageGotoParamsSchema, result: PageRefSchema },
  pageUrl: { name: "page.url", params: PageIdParamsSchema, result: PageUrlResultSchema },
  pageTitle: { name: "page.title", params: PageIdParamsSchema, result: PageTitleResultSchema },
  pageClose: { name: "page.close", params: PageIdParamsSchema, result: PageCloseResultSchema },
  pageReload: { name: "page.reload", params: PageReloadParamsSchema, result: PageRefSchema },
  pageGoBack: { name: "page.go_back", params: PageGoBackParamsSchema, result: PageRefSchema },
  pageGoForward: {
    name: "page.go_forward",
    params: PageGoForwardParamsSchema,
    result: PageRefSchema,
  },
  pageClick: {
    name: "page.click",
    params: PageClickParamsSchema,
    result: PageCoordinateResultSchema,
  },
  pageHover: {
    name: "page.hover",
    params: PageHoverParamsSchema,
    result: PageCoordinateResultSchema,
  },
  pageScroll: {
    name: "page.scroll",
    params: PageScrollParamsSchema,
    result: PageCoordinateResultSchema,
  },
  pageDragAndDrop: {
    name: "page.drag_and_drop",
    params: PageDragAndDropParamsSchema,
    result: PageDragAndDropResultSchema,
  },
  pageType: { name: "page.type", params: PageTypeParamsSchema, result: PageVoidResultSchema },
  pageKeyPress: {
    name: "page.key_press",
    params: PageKeyPressParamsSchema,
    result: PageVoidResultSchema,
  },
  pageEvaluate: {
    name: "page.evaluate",
    params: PageEvaluateParamsSchema,
    result: PageEvaluateResultSchema,
    resultWire: { opaqueKeys: ["value"] },
  },
  pageAddInitScript: {
    name: "page.add_init_script",
    params: PageAddInitScriptParamsSchema,
    result: PageVoidResultSchema,
  },
  pageSetExtraHTTPHeaders: {
    name: "page.set_extra_http_headers",
    params: PageSetExtraHTTPHeadersParamsSchema,
    result: PageVoidResultSchema,
    paramsWire: { opaqueKeys: ["headers"] },
  },
  pageScreenshot: {
    name: "page.screenshot",
    params: PageScreenshotParamsSchema,
    result: PageScreenshotResultSchema,
  },
  pageSnapshot: {
    name: "page.snapshot",
    params: PageSnapshotParamsSchema,
    result: SnapshotResultSchema,
    resultWire: { opaqueKeys: ["xpathMap", "urlMap"] },
  },
  pageSetViewportSize: {
    name: "page.set_viewport_size",
    params: PageSetViewportSizeParamsSchema,
    result: PageVoidResultSchema,
  },
  pageWaitForLoadState: {
    name: "page.wait_for_load_state",
    params: PageWaitForLoadStateParamsSchema,
    result: PageVoidResultSchema,
  },
  pageWaitForTimeout: {
    name: "page.wait_for_timeout",
    params: PageWaitForTimeoutParamsSchema,
    result: PageVoidResultSchema,
  },
  pageWaitForSelector: {
    name: "page.wait_for_selector",
    params: PageWaitForSelectorParamsSchema,
    result: PageWaitForSelectorResultSchema,
  },
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
    params: LocatorDescriptorSchema,
    result: LocatorHoverResultSchema,
  },
  locatorCount: {
    name: "locator.count",
    params: LocatorDescriptorSchema,
    result: LocatorCountResultSchema,
  },
  locatorIsChecked: {
    name: "locator.is_checked",
    params: LocatorDescriptorSchema,
    result: LocatorIsCheckedResultSchema,
  },
  locatorInputValue: {
    name: "locator.input_value",
    params: LocatorDescriptorSchema,
    result: LocatorInputValueResultSchema,
  },
  locatorIsVisible: {
    name: "locator.is_visible",
    params: LocatorDescriptorSchema,
    result: LocatorIsVisibleResultSchema,
  },
  locatorInnerText: {
    name: "locator.inner_text",
    params: LocatorDescriptorSchema,
    result: LocatorInnerTextResultSchema,
  },
  locatorInnerHtml: {
    name: "locator.inner_html",
    params: LocatorDescriptorSchema,
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
    params: LocatorDescriptorSchema,
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
  Object.values(StagehandMethods).map((method) => method.name),
);

const stagehandRpcRequestSchemas = Object.values(StagehandMethods).map((method) =>
  JSONRPCRequestSchema.extend({
    method: z.literal(method.name),
    params: wireSchema(method.params),
  }),
);

export const StagehandRpcRequestSchema = z.union(
  stagehandRpcRequestSchemas as [
    (typeof stagehandRpcRequestSchemas)[number],
    ...(typeof stagehandRpcRequestSchemas)[number][],
  ],
);

export const StagehandNotifications = {
  log: { name: "stagehand.log", params: StagehandLogSchema },
} as const satisfies Record<string, RPCNotification>;

export const StagehandRpcNotificationSchema = JSONRPCNotificationSchema.extend({
  method: z.literal(StagehandNotifications.log.name),
  params: StagehandLogSchema,
});

const stagehandMethodsByName = new Map<string, RPCMethod>(
  Object.values(StagehandMethods).map((method) => [method.name, method]),
);

export function getStagehandMethod(name: string): RPCMethod | undefined {
  return stagehandMethodsByName.get(name);
}
