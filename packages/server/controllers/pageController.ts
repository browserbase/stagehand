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
} from "../../protocol/types.js";
import type { HandlerContext } from "../rpcRouter.js";
import type { StagehandRuntime } from "../runtime.js";

export function createPageController(runtime: StagehandRuntime) {
  async function goto(params: PageGotoParams, { logger }: HandlerContext) {
    logger.info("[stagehand] page.goto", {});
    return runtime.pageGoto(params);
  }

  async function reload(params: PageReloadParams, { logger }: HandlerContext) {
    logger.info("[stagehand] page.reload", {});
    return runtime.pageReload(params);
  }

  async function goBack(params: PageGoBackParams, { logger }: HandlerContext) {
    logger.info("[stagehand] page.go_back", {});
    return runtime.pageGoBack(params);
  }

  async function goForward(params: PageGoForwardParams, { logger }: HandlerContext) {
    logger.info("[stagehand] page.go_forward", {});
    return runtime.pageGoForward(params);
  }

  async function click(params: PageClickParams, { logger }: HandlerContext) {
    logger.info("[stagehand] page.click", {});
    return runtime.pageClick(params);
  }

  async function hover(params: PageHoverParams, { logger }: HandlerContext) {
    logger.info("[stagehand] page.hover", {});
    return runtime.pageHover(params);
  }

  async function scroll(params: PageScrollParams, { logger }: HandlerContext) {
    logger.info("[stagehand] page.scroll", {});
    return runtime.pageScroll(params);
  }

  async function dragAndDrop(params: PageDragAndDropParams, { logger }: HandlerContext) {
    logger.info("[stagehand] page.drag_and_drop", {});
    return runtime.pageDragAndDrop(params);
  }

  async function type(params: PageTypeParams, { logger }: HandlerContext) {
    logger.info("[stagehand] page.type", {});
    return runtime.pageType(params);
  }

  async function keyPress(params: PageKeyPressParams, { logger }: HandlerContext) {
    logger.info("[stagehand] page.key_press", {});
    return runtime.pageKeyPress(params);
  }

  async function evaluate(params: PageEvaluateParams, { logger }: HandlerContext) {
    logger.info("[stagehand] page.evaluate", {});
    return runtime.pageEvaluate(params);
  }

  async function addInitScript(params: PageAddInitScriptParams, { logger }: HandlerContext) {
    logger.info("[stagehand] page.add_init_script", {});
    return runtime.pageAddInitScript(params);
  }

  async function setExtraHTTPHeaders(
    params: PageSetExtraHTTPHeadersParams,
    { logger }: HandlerContext,
  ) {
    logger.info("[stagehand] page.set_extra_http_headers", {});
    return runtime.pageSetExtraHTTPHeaders(params);
  }

  async function setViewportSize(params: PageSetViewportSizeParams, { logger }: HandlerContext) {
    logger.info("[stagehand] page.set_viewport_size", {});
    return runtime.pageSetViewportSize(params);
  }

  async function waitForLoadState(params: PageWaitForLoadStateParams, { logger }: HandlerContext) {
    logger.info("[stagehand] page.wait_for_load_state", {});
    return runtime.pageWaitForLoadState(params);
  }

  async function waitForTimeout(params: PageWaitForTimeoutParams, { logger }: HandlerContext) {
    logger.info("[stagehand] page.wait_for_timeout", {});
    return runtime.pageWaitForTimeout(params);
  }

  async function waitForSelector(params: PageWaitForSelectorParams, { logger }: HandlerContext) {
    logger.info("[stagehand] page.wait_for_selector", {});
    return runtime.pageWaitForSelector(params);
  }

  async function screenshot(params: PageScreenshotParams, { logger }: HandlerContext) {
    logger.info("[stagehand] page.screenshot", {});
    return runtime.pageScreenshot(params);
  }

  async function snapshot(params: PageSnapshotParams, { logger }: HandlerContext) {
    logger.info("[stagehand] page.snapshot", {});
    return runtime.pageSnapshot(params);
  }

  async function url(params: PageIdParams, { logger }: HandlerContext) {
    logger.info("[stagehand] page.url", {});
    return runtime.pageUrl(params);
  }

  async function title(params: PageIdParams, { logger }: HandlerContext) {
    logger.info("[stagehand] page.title", {});
    return runtime.pageTitle(params);
  }

  async function close(params: PageIdParams, { logger }: HandlerContext) {
    logger.info("[stagehand] page.close", {});
    return runtime.pageClose(params);
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
    url,
    title,
    close,
  };
}
