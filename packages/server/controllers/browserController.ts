import type { EmptyParams } from "../../protocol/types.js";
import type { HandlerContext } from "../rpcRouter.js";
import type { StagehandRuntime } from "../runtime.js";

export function createBrowserController(runtime: StagehandRuntime) {
  async function getVersion(_params: EmptyParams, { logger }: HandlerContext) {
    logger.info("[stagehand] browser.get_version", {});
    return runtime.browserGetVersion();
  }

  return {
    getVersion,
  };
}
