import type { ContextNewPageParams, EmptyParams } from "../../protocol/types.js";
import type { HandlerContext } from "../rpcRouter.js";
import type { StagehandRuntime } from "../runtime.js";

export function createContextController(runtime: StagehandRuntime) {
  async function pages(_params: EmptyParams, { logger }: HandlerContext) {
    logger.info("[stagehand] context.pages", {});
    return runtime.contextPages();
  }

  async function newPage(params: ContextNewPageParams, { logger }: HandlerContext) {
    logger.info("[stagehand] context.new_page", {});
    return runtime.contextNewPage(params);
  }

  return {
    pages,
    newPage,
  };
}
