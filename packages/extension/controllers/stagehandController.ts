import type {
  EmptyParams,
  StagehandActParams,
  StagehandExtractParams,
  StagehandInitParams,
  StagehandObserveParams,
} from "../../protocol/types.js";
import type { StagehandHandlerContext } from "../rpc/router.js";
import { StagehandRuntimeError, type StagehandRuntime } from "../runtime.js";

export function createStagehandController(runtime: StagehandRuntime) {
  async function init(
    _params: StagehandInitParams,
    { logger }: StagehandHandlerContext,
  ): Promise<never> {
    logger.info("[stagehand] stagehand.init", {});
    throw new StagehandRuntimeError(
      "Method not implemented by the smoke runtime",
      -32601,
      "stagehand.unknown_command",
    );
  }

  async function close(_params: EmptyParams, { logger }: StagehandHandlerContext) {
    logger.info("[stagehand] stagehand.close", {});
    await runtime.close();
    return { closed: true as const };
  }

  async function act(
    _params: StagehandActParams,
    { logger }: StagehandHandlerContext,
  ): Promise<never> {
    logger.info("[stagehand] stagehand.act", {});
    throw new StagehandRuntimeError(
      "Method not implemented by the smoke runtime",
      -32601,
      "stagehand.unknown_command",
    );
  }

  async function observe(
    _params: StagehandObserveParams,
    { logger }: StagehandHandlerContext,
  ): Promise<never> {
    logger.info("[stagehand] stagehand.observe", {});
    throw new StagehandRuntimeError(
      "Method not implemented by the smoke runtime",
      -32601,
      "stagehand.unknown_command",
    );
  }

  async function extract(
    _params: StagehandExtractParams,
    { logger }: StagehandHandlerContext,
  ): Promise<never> {
    logger.info("[stagehand] stagehand.extract", {});
    throw new StagehandRuntimeError(
      "Method not implemented by the smoke runtime",
      -32601,
      "stagehand.unknown_command",
    );
  }

  async function metrics(
    _params: EmptyParams,
    { logger }: StagehandHandlerContext,
  ): Promise<never> {
    logger.info("[stagehand] stagehand.metrics", {});
    throw new StagehandRuntimeError(
      "Method not implemented by the smoke runtime",
      -32601,
      "stagehand.unknown_command",
    );
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
