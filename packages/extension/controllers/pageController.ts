import type { PageGotoParams, PageIdParams } from "../../protocol/types.js";
import type { HandlerContext } from "../rpcRouter.js";
import type { StagehandRuntime } from "../runtime.js";

export function createPageController(runtime: StagehandRuntime) {
  async function goto(params: PageGotoParams, { logger }: HandlerContext) {
    logger.info("[stagehand] page.goto", {});
    return runtime.pageGoto(params);
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
    url,
    title,
    close,
  };
}
