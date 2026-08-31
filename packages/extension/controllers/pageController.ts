import type {
  PageAddInitScriptParams,
  PageClickParams,
  PageDragAndDropParams,
  PageEvaluateParams,
  PageGoBackParams,
  PageGoForwardParams,
  PageGotoParams,
  PageHoverParams,
  PageIdParams,
  PageKeyPressParams,
  PageOffParams,
  PageOnParams,
  PageReloadParams,
  PageScrollParams,
  PageScreenshotParams,
  PageSetExtraHTTPHeadersParams,
  PageSetViewportSizeParams,
  PageSnapshotParams,
  PageTypeParams,
  PageWaitForLoadStateParams,
  PageWaitForSelectorParams,
  PageWaitForTimeoutParams,
  PageWebMCPCancelInvocationParams,
  PageWebMCPInvocationResultParams,
  PageWebMCPInvokeToolParams,
  PageWebMCPToolsParams,
} from "@browserbasehq/stagehand-protocol/types";
import type { HandlerContext } from "../rpcRouter.js";
import type { StagehandRuntime } from "../runtime.js";

export function createPageController(runtime: StagehandRuntime) {
  async function goto(params: PageGotoParams, { logger }: HandlerContext) {
    logger.debug("page.goto", {});
    return runtime.pageGoto(params);
  }

  async function reload(params: PageReloadParams, { logger }: HandlerContext) {
    logger.debug("page.reload", {});
    return runtime.pageReload(params);
  }

  async function goBack(params: PageGoBackParams, { logger }: HandlerContext) {
    logger.debug("page.go_back", {});
    return runtime.pageGoBack(params);
  }

  async function goForward(params: PageGoForwardParams, { logger }: HandlerContext) {
    logger.debug("page.go_forward", {});
    return runtime.pageGoForward(params);
  }

  async function click(params: PageClickParams, { logger }: HandlerContext) {
    logger.debug("page.click", {});
    return runtime.pageClick(params);
  }

  async function hover(params: PageHoverParams, { logger }: HandlerContext) {
    logger.debug("page.hover", {});
    return runtime.pageHover(params);
  }

  async function scroll(params: PageScrollParams, { logger }: HandlerContext) {
    logger.debug("page.scroll", {});
    return runtime.pageScroll(params);
  }

  async function dragAndDrop(params: PageDragAndDropParams, { logger }: HandlerContext) {
    logger.debug("page.drag_and_drop", {});
    return runtime.pageDragAndDrop(params);
  }

  async function type(params: PageTypeParams, { logger }: HandlerContext) {
    logger.debug("page.type", {});
    return runtime.pageType(params);
  }

  async function keyPress(params: PageKeyPressParams, { logger }: HandlerContext) {
    logger.debug("page.key_press", {});
    return runtime.pageKeyPress(params);
  }

  async function evaluate(params: PageEvaluateParams, { logger }: HandlerContext) {
    logger.debug("page.evaluate", {});
    return runtime.pageEvaluate(params);
  }

  async function addInitScript(params: PageAddInitScriptParams, { logger }: HandlerContext) {
    logger.debug("page.add_init_script", {});
    return runtime.pageAddInitScript(params);
  }

  async function setExtraHTTPHeaders(
    params: PageSetExtraHTTPHeadersParams,
    { logger }: HandlerContext,
  ) {
    logger.debug("page.set_extra_http_headers", {});
    return runtime.pageSetExtraHTTPHeaders(params);
  }

  async function setViewportSize(params: PageSetViewportSizeParams, { logger }: HandlerContext) {
    logger.debug("page.set_viewport_size", {});
    return runtime.pageSetViewportSize(params);
  }

  async function waitForLoadState(params: PageWaitForLoadStateParams, { logger }: HandlerContext) {
    logger.debug("page.wait_for_load_state", {});
    return runtime.pageWaitForLoadState(params);
  }

  async function waitForTimeout(params: PageWaitForTimeoutParams, { logger }: HandlerContext) {
    logger.debug("page.wait_for_timeout", {});
    return runtime.pageWaitForTimeout(params);
  }

  async function waitForSelector(params: PageWaitForSelectorParams, { logger }: HandlerContext) {
    logger.debug("page.wait_for_selector", {});
    return runtime.pageWaitForSelector(params);
  }

  async function screenshot(params: PageScreenshotParams, { logger }: HandlerContext) {
    logger.debug("page.screenshot", {});
    return runtime.pageScreenshot(params);
  }

  async function snapshot(params: PageSnapshotParams, { logger }: HandlerContext) {
    logger.debug("page.snapshot", {});
    return runtime.pageSnapshot(params);
  }

  async function webMCPTools(params: PageWebMCPToolsParams, { logger }: HandlerContext) {
    logger.debug("page.webmcp_tools", {});
    return runtime.pageWebMCPTools(params);
  }

  async function webMCPInvokeTool(params: PageWebMCPInvokeToolParams, { logger }: HandlerContext) {
    logger.debug("page.webmcp_invoke_tool", {});
    return runtime.pageWebMCPInvokeTool(params);
  }

  async function webMCPInvocationResult(
    params: PageWebMCPInvocationResultParams,
    { logger }: HandlerContext,
  ) {
    logger.debug("page.webmcp_invocation_result", {});
    return runtime.pageWebMCPInvocationResult(params);
  }

  async function webMCPCancelInvocation(
    params: PageWebMCPCancelInvocationParams,
    { logger }: HandlerContext,
  ) {
    logger.debug("page.webmcp_cancel_invocation", {});
    return runtime.pageWebMCPCancelInvocation(params);
  }

  async function url(params: PageIdParams, { logger }: HandlerContext) {
    logger.debug("page.url", {});
    return runtime.pageUrl(params);
  }

  async function title(params: PageIdParams, { logger }: HandlerContext) {
    logger.debug("page.title", {});
    return runtime.pageTitle(params);
  }

  async function close(params: PageIdParams, { logger }: HandlerContext) {
    logger.debug("page.close", {});
    return runtime.pageClose(params);
  }

  async function on(params: PageOnParams, { logger }: HandlerContext) {
    logger.debug("page.on", {});
    return runtime.pageOn(params);
  }

  async function off(params: PageOffParams, { logger }: HandlerContext) {
    logger.debug("page.off", {});
    return runtime.pageOff(params);
  }

  return {
    goto,
    reload,
    goBack,
    goForward,
    click,
    hover,
    scroll,
    dragAndDrop,
    type,
    keyPress,
    evaluate,
    addInitScript,
    setExtraHTTPHeaders,
    setViewportSize,
    waitForLoadState,
    waitForTimeout,
    waitForSelector,
    screenshot,
    snapshot,
    webMCPTools,
    webMCPInvokeTool,
    webMCPInvocationResult,
    webMCPCancelInvocation,
    url,
    title,
    close,
    on,
    off,
  };
}
