import type {
  EmptyParams,
  StagehandActParams,
  StagehandExtractParams,
  StagehandInitParams,
  StagehandInitResult,
  StagehandObserveParams,
} from "@browserbasehq/stagehand-protocol/types";
import {
  checkProtocolCompatibility,
  STAGEHAND_PROTOCOL_VERSION,
} from "@browserbasehq/stagehand-protocol/protocol-version";
import type { HandlerContext } from "../rpcRouter.js";
import { StagehandProtocolCompatibilityError } from "../errors.js";
import type { StagehandRuntime } from "../runtime.js";
import * as actService from "../services/actService.js";
import * as cacheService from "../services/cacheService.js";
import * as extractService from "../services/extractService.js";
import { buildGatewayContext } from "../llm/gatewayClient.js";
import * as observeService from "../services/observeService.js";

export type StagehandControllerOptions = {
  initialize?: (params: StagehandInitParams) => Promise<StagehandInitResult>;
  close?: () => Promise<void>;
};

export function createStagehandController(
  runtime: StagehandRuntime,
  options: StagehandControllerOptions = {},
) {
  const closeRuntime = options.close ?? (() => runtime.disposeStagehandInstance());

  async function runOperation<Result>(
    name: string,
    { logger, telemetryScope }: HandlerContext,
    run: (logger: HandlerContext["logger"]) => Result | Promise<Result>,
  ): Promise<Result> {
    return await logger.span(name, {}, (logger) =>
      runtime.runWithTelemetryContext(telemetryScope, logger, () => run(logger)),
    );
  }

  async function init(params: StagehandInitParams, { logger }: HandlerContext) {
    const compatibility = checkProtocolCompatibility(
      params.protocolVersion,
      STAGEHAND_PROTOCOL_VERSION,
    );
    if (compatibility.compatible === false) {
      throw new StagehandProtocolCompatibilityError(compatibility.reason);
    }
    logger.setLevel(params.logLevel);
    logger.info("stagehand.init", {});
    return options.initialize
      ? await options.initialize(params)
      : await runtime.initialize(params, logger);
  }

  async function close(_params: EmptyParams, { logger }: HandlerContext) {
    logger.info("stagehand.close", {});
    await closeRuntime();
    return { closed: true as const };
  }

  async function act(params: StagehandActParams, context: HandlerContext) {
    return await runOperation("stagehand.act", context, async (logger) => {
      logger.debug("stagehand.act", {});
      const state = runtime.state.getState();
      if (state.status !== "initialized") {
        throw new Error("Stagehand must be initialized before acting");
      }

      const model = params.options?.model ?? state.initParams.model;
      const gateway = buildGatewayContext(state.initParams);
      if (!model && !gateway) {
        throw new Error("An LLM was not configured during Stagehand initialization");
      }

      const result = await actService.act({
        params,
        page: runtime.resolveUnderstudyPage(params.pageId),
        model,
        clientLLMGenerate: runtime.adapters.clientLLMGenerate,
        logger,
        systemPrompt: state.initParams.systemPrompt,
        selfHeal: state.initParams.selfHeal,
        domSettleTimeoutMs: state.initParams.domSettleTimeoutMs,
        cache: cacheService.buildCacheContext(state.initParams),
        gateway,
      });
      runtime.metrics.record("act", result.metadata.usage);
      return result;
    });
  }

  async function observe(params: StagehandObserveParams, context: HandlerContext) {
    return await runOperation("stagehand.observe", context, async (logger) => {
      logger.debug("stagehand.observe", {});
      const state = runtime.state.getState();
      if (state.status !== "initialized") {
        throw new Error("Stagehand must be initialized before observing");
      }

      const model = params.options?.model ?? state.initParams.model;
      const gateway = buildGatewayContext(state.initParams);
      if (!model && !gateway) {
        throw new Error("An LLM was not configured during Stagehand initialization");
      }

      const result = await observeService.observe({
        params,
        page: runtime.resolvePage(params.pageId),
        model,
        clientLLMGenerate: runtime.adapters.clientLLMGenerate,
        logger,
        systemPrompt: state.initParams.systemPrompt,
        cache: cacheService.buildCacheContext(state.initParams),
        gateway,
      });
      runtime.metrics.record("observe", result.metadata.usage);
      return result;
    });
  }

  async function extract(params: StagehandExtractParams, context: HandlerContext) {
    return await runOperation("stagehand.extract", context, async (logger) => {
      logger.debug("stagehand.extract", {});
      const state = runtime.state.getState();
      if (state.status !== "initialized") {
        throw new Error("Stagehand must be initialized before extracting");
      }

      const model = params.options?.model ?? state.initParams.model;
      const gateway = buildGatewayContext(state.initParams);
      if (!model && !gateway) {
        throw new Error("An LLM was not configured during Stagehand initialization");
      }

      const result = await extractService.extract({
        params,
        page: runtime.resolvePage(params.pageId),
        model,
        clientLLMGenerate: runtime.adapters.clientLLMGenerate,
        logger,
        systemPrompt: state.initParams.systemPrompt,
        cache: cacheService.buildCacheContext(state.initParams),
        gateway,
      });
      runtime.metrics.record("extract", result.metadata.usage);
      return result;
    });
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
