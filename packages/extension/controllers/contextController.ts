import type { ContextNewPageParams, EmptyParams } from "../../protocol/types.js";
import type { StagehandHandlerContext } from "../rpc/router.js";
import type { StagehandRuntime } from "../runtime.js";

export function createContextController(runtime: StagehandRuntime) {
  async function pages(_params: EmptyParams, { logger }: StagehandHandlerContext) {
    logger.info("[stagehand] context.pages", {});
    return runtime.contextPages();
  }

  async function newPage(params: ContextNewPageParams, { logger }: StagehandHandlerContext) {
    logger.info("[stagehand] context.new_page", {});
    return runtime.contextNewPage(params);
  }

  return {
    pages,
    newPage,
  };
}
