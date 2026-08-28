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
  CallbackBatchParamsSchema,
  CallbackBatchResultSchema,
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
  LocatorSetInputFilesParamsSchema,
  LocatorSetInputFilesResultSchema,
  LocatorSendClickEventParamsSchema,
  LocatorSendClickEventResultSchema,
  LocatorTextContentResultSchema,
  LocatorTypeParamsSchema,
  LocatorTypeResultSchema,
  LLMGenerateParamsSchema,
  LLMGenerateResultSchema,
  ObserveResultSchema,
  PageAddInitScriptParamsSchema,
  PageCDPEventNotificationSchema,
  PageClickParamsSchema,
  PageCloseResultSchema,
  PageDragAndDropParamsSchema,
  PageEvaluateParamsSchema,
  PageEvaluateResultSchema,
  PageGoBackParamsSchema,
  PageGoForwardParamsSchema,
  PageGotoParamsSchema,
  PageHoverParamsSchema,
  PageIdParamsSchema,
  PageKeyPressParamsSchema,
  PageNavigationResultSchema,
  PageOffParamsSchema,
  PageOnParamsSchema,
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
  PageWebMCPCancelInvocationParamsSchema,
  PageWebMCPInvocationResultParamsSchema,
  PageWebMCPInvokeToolParamsSchema,
  PageWebMCPToolsParamsSchema,
  PageWebMCPToolsResultSchema,
  ResponseAllHeadersResultSchema,
  ResponseBodyResultSchema,
  ResponseFinishedResultSchema,
  ResponseHeadersArrayResultSchema,
  ResponseIdParamsSchema,
  ResponseSecurityDetailsResultSchema,
  ResponseServerAddrResultSchema,
  StagehandActParamsSchema,
  StagehandCloseResultSchema,
  StagehandExtractParamsSchema,
  StagehandInitParamsSchema,
  StagehandInitResultSchema,
  StagehandLogSchema,
  StagehandMetricsSchema,
  StagehandObserveParamsSchema,
  SnapshotResultSchema,
  WebMCPInvocationDescriptorSchema,
  WebMCPToolResponseSchema,
} from "./schemas.ts";

export const STAGEHAND_SEND_TO_HOST_BINDING = "__stagehandSendToHost";
export const StagehandSendToHostBindingSchema = z
  .literal(STAGEHAND_SEND_TO_HOST_BINDING)
  .meta({ id: "StagehandSendToHostBinding" });

export const StagehandMethods = {
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
    resultWire: { transformKeys: ["data"] },
  },
  stagehandObserve: {
    name: "stagehand.observe",
    params: StagehandObserveParamsSchema,
    result: ObserveResultSchema,
    resultWire: { transformKeys: ["data"] },
  },
  stagehandExtract: {
    name: "stagehand.extract",
    params: StagehandExtractParamsSchema,
    result: ExtractResultSchema,
    paramsWire: { opaqueKeys: ["schema"] },
    resultWire: { opaqueKeys: ["data"] },
  },
  stagehandMetrics: {
    name: "stagehand.metrics",
    params: EmptyParamsSchema,
    result: StagehandMetricsSchema,
  },
  stagehandCallbackBatch: {
    name: "stagehand.callback_batch",
    params: CallbackBatchParamsSchema,
    result: CallbackBatchResultSchema,
    paramsWire: { opaqueKeys: ["input"] },
    resultWire: { opaqueKeys: ["value"] },
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
  pageGoto: {
    name: "page.goto",
    params: PageGotoParamsSchema,
    result: PageNavigationResultSchema,
    resultWire: { opaqueKeys: ["headers"] },
  },
  pageUrl: { name: "page.url", params: PageIdParamsSchema, result: PageUrlResultSchema },
  pageTitle: { name: "page.title", params: PageIdParamsSchema, result: PageTitleResultSchema },
  pageClose: { name: "page.close", params: PageIdParamsSchema, result: PageCloseResultSchema },
  pageReload: {
    name: "page.reload",
    params: PageReloadParamsSchema,
    result: PageNavigationResultSchema,
    resultWire: { opaqueKeys: ["headers"] },
  },
  pageGoBack: {
    name: "page.go_back",
    params: PageGoBackParamsSchema,
    result: PageNavigationResultSchema,
    resultWire: { opaqueKeys: ["headers"] },
  },
  pageGoForward: {
    name: "page.go_forward",
    params: PageGoForwardParamsSchema,
    result: PageNavigationResultSchema,
    resultWire: { opaqueKeys: ["headers"] },
  },
  pageClick: {
    name: "page.click",
    params: PageClickParamsSchema,
    result: PageVoidResultSchema,
  },
  pageHover: {
    name: "page.hover",
    params: PageHoverParamsSchema,
    result: PageVoidResultSchema,
  },
  pageScroll: {
    name: "page.scroll",
    params: PageScrollParamsSchema,
    result: PageVoidResultSchema,
  },
  pageDragAndDrop: {
    name: "page.drag_and_drop",
    params: PageDragAndDropParamsSchema,
    result: PageVoidResultSchema,
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
  pageOn: {
    name: "page.on",
    params: PageOnParamsSchema,
    result: PageVoidResultSchema,
  },
  pageOff: {
    name: "page.off",
    params: PageOffParamsSchema,
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
  pageWebMCPTools: {
    name: "page.webmcp_tools",
    params: PageWebMCPToolsParamsSchema,
    result: PageWebMCPToolsResultSchema,
    resultWire: { opaqueKeys: ["inputSchema"] },
  },
  pageWebMCPInvokeTool: {
    name: "page.webmcp_invoke_tool",
    params: PageWebMCPInvokeToolParamsSchema,
    result: WebMCPInvocationDescriptorSchema,
    paramsWire: { opaqueKeys: ["input"] },
    resultWire: { opaqueKeys: ["input"] },
  },
  pageWebMCPInvocationResult: {
    name: "page.webmcp_invocation_result",
    params: PageWebMCPInvocationResultParamsSchema,
    result: WebMCPToolResponseSchema,
    resultWire: { opaqueKeys: ["output", "exception"] },
  },
  pageWebMCPCancelInvocation: {
    name: "page.webmcp_cancel_invocation",
    params: PageWebMCPCancelInvocationParamsSchema,
    result: PageVoidResultSchema,
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
  locatorSetInputFiles: {
    name: "locator.set_input_files",
    params: LocatorSetInputFilesParamsSchema,
    result: LocatorSetInputFilesResultSchema,
  },
  responseBody: {
    name: "response.body",
    params: ResponseIdParamsSchema,
    result: ResponseBodyResultSchema,
  },
  responseAllHeaders: {
    name: "response.all_headers",
    params: ResponseIdParamsSchema,
    result: ResponseAllHeadersResultSchema,
    resultWire: { opaqueKeys: ["headers"] },
  },
  responseHeadersArray: {
    name: "response.headers_array",
    params: ResponseIdParamsSchema,
    result: ResponseHeadersArrayResultSchema,
  },
  responseSecurityDetails: {
    name: "response.security_details",
    params: ResponseIdParamsSchema,
    result: ResponseSecurityDetailsResultSchema,
  },
  responseServerAddr: {
    name: "response.server_addr",
    params: ResponseIdParamsSchema,
    result: ResponseServerAddrResultSchema,
  },
  responseFinished: {
    name: "response.finished",
    params: ResponseIdParamsSchema,
    result: ResponseFinishedResultSchema,
  },
} as const satisfies Record<string, RPCMethod>;

export const StagehandMethodSchema = z
  .enum(Object.values(StagehandMethods).map((method) => method.name))
  .meta({ id: "StagehandMethod" });

const stagehandRpcRequestSchemas = Object.values(StagehandMethods).map((method) =>
  JSONRPCRequestSchema.extend({
    method: z.literal(method.name),
    params: wireSchema(method.params, "paramsWire" in method ? method.paramsWire : undefined),
  }),
);

export const StagehandRpcRequestSchema = z
  .union(
    stagehandRpcRequestSchemas as [
      (typeof stagehandRpcRequestSchemas)[number],
      ...(typeof stagehandRpcRequestSchemas)[number][],
    ],
  )
  .meta({ id: "StagehandRpcRuntimeRequest" });

export const StagehandNotifications = {
  log: { name: "stagehand.log", params: StagehandLogSchema, paramsWire: undefined },
  pageCDPEvent: {
    name: "page.cdp_event",
    params: PageCDPEventNotificationSchema,
    paramsWire: { opaqueKeys: ["params"] },
  },
} as const satisfies Record<string, RPCNotification>;

type RegisteredNotificationSchema = {
  [Key in keyof typeof StagehandNotifications]: z.ZodType<{
    jsonrpc: "2.0";
    method: (typeof StagehandNotifications)[Key]["name"];
    params: z.output<(typeof StagehandNotifications)[Key]["params"]>;
  }>;
}[keyof typeof StagehandNotifications];

// Object.values() cannot preserve the per-entry method/params correlation needed by this
// dynamically assembled union. notification.test-d.ts pins the asserted relationship.
const stagehandRpcNotificationSchemas = Object.values(StagehandNotifications).map((notification) =>
  JSONRPCNotificationSchema.extend({
    method: z.literal(notification.name),
    params: wireSchema(notification.params, notification.paramsWire),
  }),
) as unknown as RegisteredNotificationSchema[];

export const StagehandRpcNotificationSchema = z
  .union(
    stagehandRpcNotificationSchemas as [
      RegisteredNotificationSchema,
      ...RegisteredNotificationSchema[],
    ],
  )
  .meta({ id: "StagehandRpcRuntimeNotification" });

const stagehandMethodsByName = new Map<string, RPCMethod>(
  Object.values(StagehandMethods).map((method) => [method.name, method]),
);

export function getStagehandMethod(name: string): RPCMethod | undefined {
  return stagehandMethodsByName.get(name);
}
