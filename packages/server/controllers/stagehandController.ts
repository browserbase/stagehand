import type {
  EmptyParams,
  StagehandActParams,
  StagehandExtractParams,
  StagehandInitParams,
  StagehandInitResult,
  StagehandObserveParams,
} from "../../protocol/types.js";
import type { HandlerContext } from "../rpcRouter.js";
import type { StagehandRuntime } from "../runtime.js";
import * as actService from "../services/actService.js";
import * as cacheService from "../services/cacheService.js";
import * as extractService from "../services/extractService.js";
import { buildGatewayContext } from "../llm/gatewayClient.js";
import * as observeService from "../services/observeService.js";
import { withTimeout } from "../timeoutConfig.js";

export type StagehandControllerOptions = {
  initialize?: (params: StagehandInitParams) => Promise<StagehandInitResult>;
  close?: () => Promise<void>;
};

export function createStagehandController(
  runtime: StagehandRuntime,
  options: StagehandControllerOptions = {},
) {
  const initialize = options.initialize ?? ((params) => runtime.initialize(params));
  const closeRuntime = options.close ?? (() => runtime.close());

  async function init(params: StagehandInitParams, { logger }: HandlerContext) {
    logger.setLevel(params.logLevel);
    logger.info("stagehand.init", {});
    return await initialize(params);
  }

  async function close(_params: EmptyParams, { logger }: HandlerContext) {
    logger.info("stagehand.close", {});
    await closeRuntime();
    return { closed: true as const };
  }

  async function act(params: StagehandActParams, { logger }: HandlerContext) {
    logger.debug("stagehand.act", {});
    const state = runtime.state.getState();
    if (state.status !== "initialized") {
      throw new Error("Stagehand must be initialized before acting");
    }

    const model = params.options?.model ?? state.initParams.model;
    if (!model) {
      throw new Error("An LLM was not configured during Stagehand initialization");
    }

    const result = await withTimeout(
      actService.act({
        params,
        page: runtime.resolveUnderstudyPage(params.pageId),
        model,
        clientLLMGenerate: runtime.adapters.clientLLMGenerate,
        logger,
        systemPrompt: state.initParams.systemPrompt,
        selfHeal: state.initParams.selfHeal,
        domSettleTimeoutMs: state.initParams.domSettleTimeoutMs,
        cache: cacheService.buildCacheContext(state.initParams),
        gateway: buildGatewayContext(state.initParams),
      }),
      params.options?.timeout,
      "act()",
    );
    runtime.metrics.record("act", result.metadata.usage);
    return result;
  }

  async function observe(params: StagehandObserveParams, { logger }: HandlerContext) {
    logger.debug("stagehand.observe", {});
    const state = runtime.state.getState();
    if (state.status !== "initialized") {
      throw new Error("Stagehand must be initialized before observing");
    }

    const model = params.options?.model ?? state.initParams.model;
    if (!model) {
      throw new Error("An LLM was not configured during Stagehand initialization");
    }

    const result = await withTimeout(
      observeService.observe({
        params,
        page: runtime.resolvePage(params.pageId),
        model,
        clientLLMGenerate: runtime.adapters.clientLLMGenerate,
        logger,
        systemPrompt: state.initParams.systemPrompt,
        cache: cacheService.buildCacheContext(state.initParams),
        gateway: buildGatewayContext(state.initParams),
      }),
      params.options?.timeout,
      "observe()",
    );
    runtime.metrics.record("observe", result.metadata.usage);
    return result;
  }

  async function extract(params: StagehandExtractParams, { logger }: HandlerContext) {
    logger.debug("stagehand.extract", {});
    const state = runtime.state.getState();
    if (state.status !== "initialized") {
      throw new Error("Stagehand must be initialized before extracting");
    }

    const model = params.options?.model ?? state.initParams.model;
    if (!model) {
      throw new Error("An LLM was not configured during Stagehand initialization");
    }

    const result = await withTimeout(
      extractService.extract({
        params,
        page: runtime.resolvePage(params.pageId),
        model,
        clientLLMGenerate: runtime.adapters.clientLLMGenerate,
        logger,
        systemPrompt: state.initParams.systemPrompt,
        cache: cacheService.buildCacheContext(state.initParams),
        gateway: buildGatewayContext(state.initParams),
      }),
      params.options?.timeout,
      "extract()",
    );
    runtime.metrics.record("extract", result.metadata.usage);
    return result;
  }

  async function metrics(_params: EmptyParams, { logger }: HandlerContext) {
    logger.debug("stagehand.metrics", {});
    return runtime.metrics.snapshot();
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
