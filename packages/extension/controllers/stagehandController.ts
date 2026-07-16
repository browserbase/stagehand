import type {
  EmptyParams,
  StagehandActParams,
  StagehandExtractParams,
  StagehandInitParams,
  StagehandObserveParams,
} from "../../protocol/types.js";
import type { HandlerContext } from "../rpcRouter.js";
import type { StagehandRuntime } from "../runtime.js";

export function createStagehandController(runtime: StagehandRuntime) {
  async function init(params: StagehandInitParams, { logger }: HandlerContext) {
    logger.info("[stagehand] stagehand.init", {});
    return await runtime.initialize(params);
  }

  async function close(_params: EmptyParams, { logger }: HandlerContext) {
    logger.info("[stagehand] stagehand.close", {});
    await runtime.close();
    return { closed: true as const };
  }

  async function act(_params: StagehandActParams, { logger }: HandlerContext): Promise<never> {
    logger.info("[stagehand] stagehand.act", {});
    throw new Error("Method not implemented by the smoke runtime");
  }

  async function observe(
    _params: StagehandObserveParams,
    { logger }: HandlerContext,
  ): Promise<never> {
    logger.info("[stagehand] stagehand.observe", {});
    throw new Error("Method not implemented by the smoke runtime");
  }

  async function extract(
    _params: StagehandExtractParams,
    { logger }: HandlerContext,
  ): Promise<never> {
    logger.info("[stagehand] stagehand.extract", {});
    throw new Error("Method not implemented by the smoke runtime");
  }

  async function metrics(_params: EmptyParams, { logger }: HandlerContext): Promise<never> {
    logger.info("[stagehand] stagehand.metrics", {});
    throw new Error("Method not implemented by the smoke runtime");
  }

  return {
    init,
    close,
    act,
    observe,
    extract,
    metrics,
  };
}
