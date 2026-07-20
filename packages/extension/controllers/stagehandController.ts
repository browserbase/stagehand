import type {
  EmptyParams,
  StagehandActParams,
  StagehandExtractParams,
  StagehandInitParams,
  StagehandObserveParams,
} from "../../protocol/types.js";
import type { HandlerContext } from "../rpcRouter.js";
import type { StagehandRuntime } from "../runtime.js";
import * as extractService from "../services/extractService.js";
import * as observeService from "../services/observeService.js";

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

  async function observe(params: StagehandObserveParams, { logger }: HandlerContext) {
    logger.info("[stagehand] stagehand.observe", {});
    const state = runtime.state.getState();
    if (state.status !== "initialized") {
      throw new Error("Stagehand must be initialized before observing");
    }

    const model = params.options?.model ?? state.initParams.model;
    if (!model) {
      throw new Error("An LLM was not configured during Stagehand initialization");
    }

    return await observeService.observe({
      params,
      page: runtime.resolvePage(params.pageId),
      model,
      clientLLMGenerate: runtime.adapters.clientLLMGenerate,
      logger,
      systemPrompt: state.initParams.systemPrompt,
      experimental: state.initParams.experimental,
    });
  }

  async function extract(params: StagehandExtractParams, { logger }: HandlerContext) {
    logger.info("[stagehand] stagehand.extract", {});
    const state = runtime.state.getState();
    if (state.status !== "initialized") {
      throw new Error("Stagehand must be initialized before extracting");
    }

    const model = params.options?.model ?? state.initParams.model;
    if (!model) {
      throw new Error("An LLM was not configured during Stagehand initialization");
    }

    return await extractService.extract({
      params,
      page: runtime.resolvePage(params.pageId),
      model,
      clientLLMGenerate: runtime.adapters.clientLLMGenerate,
      logger,
      systemPrompt: state.initParams.systemPrompt,
      experimental: state.initParams.experimental,
    });
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
