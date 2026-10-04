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
import { decisionDrivers, llmDrivers, type Drivers } from "../services/drivers/index.js";
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

  /**
   * act, observe and extract under one set of drivers. The services are the same for every
   * set; which drivers they are handed is the whole difference between `stagehand.act()` and
   * `stagehand.experimentalDecisions.act()`.
   */
  function aiOperations(
    names: { act: string; observe: string; extract: string },
    driversFor: (initParams: StagehandInitParams, method: "act" | "observe" | "extract") => Drivers,
  ) {
    function configured(action: string) {
      const state = runtime.state.getState();
      if (state.status !== "initialized") {
        throw new Error(`Stagehand must be initialized before ${action}`);
      }
      const { initParams } = state;
      const gateway = buildGatewayContext(initParams);
      return { initParams, gateway };
    }

    function serviceEnvironment(
      initParams: StagehandInitParams,
      gateway: ReturnType<typeof buildGatewayContext>,
      override: StagehandInitParams["model"],
    ) {
      const model = override ?? initParams.model;
      if (!model && !gateway) {
        throw new Error("An LLM was not configured during Stagehand initialization");
      }
      return {
        model,
        clientLLMGenerate: runtime.adapters.clientLLMGenerate,
        systemPrompt: initParams.systemPrompt,
        cache: cacheService.buildCacheContext(initParams),
        gateway,
      };
    }

    async function act(params: StagehandActParams, context: HandlerContext) {
      return await runOperation(names.act, context, async (logger) => {
        logger.debug(names.act, {});
        const { initParams, gateway } = configured("acting");
        const environment = serviceEnvironment(initParams, gateway, params.options?.model);
        const drivers = driversFor(initParams, "act");
        const result = await actService.act({
          params,
          page: runtime.resolveUnderstudyPage(params.pageId),
          ...environment,
          logger,
          selfHeal: initParams.selfHeal,
          domSettleTimeoutMs: initParams.domSettleTimeoutMs,
          openPageCount: () => runtime.requireBrowserSession().pages().length,
          driver: drivers.act,
          cachedActionGuard: drivers.cachedActionGuard,
          logTiming: drivers.logActTiming,
        });
        runtime.metrics.record("act", result.metadata.usage);
        return result;
      });
    }

    async function observe(params: StagehandObserveParams, context: HandlerContext) {
      return await runOperation(names.observe, context, async (logger) => {
        logger.debug(names.observe, {});
        const { initParams, gateway } = configured("observing");
        const environment = serviceEnvironment(initParams, gateway, params.options?.model);
        const result = await observeService.observe({
          params,
          page: runtime.resolvePage(params.pageId),
          ...environment,
          logger,
          driver: driversFor(initParams, "observe").observe,
        });
        runtime.metrics.record("observe", result.metadata.usage);
        return result;
      });
    }

    async function extract(params: StagehandExtractParams, context: HandlerContext) {
      return await runOperation(names.extract, context, async (logger) => {
        logger.debug(names.extract, {});
        const { initParams, gateway } = configured("extracting");
        const environment = serviceEnvironment(initParams, gateway, params.options?.model);
        const result = await extractService.extract({
          params,
          page: runtime.resolvePage(params.pageId),
          ...environment,
          logger,
          driver: driversFor(initParams, "extract").extract,
        });
        runtime.metrics.record("extract", result.metadata.usage);
        return result;
      });
    }

    return { act, observe, extract };
  }

  // The plain methods never ask a decision model. When one is configured they log each act's
  // timing, so the two paths can be compared.
  const llmOperations = aiOperations(
    { act: "stagehand.act", observe: "stagehand.observe", extract: "stagehand.extract" },
    (initParams) => llmDrivers({ logActTiming: initParams.experimentalDecisions !== undefined }),
  );

  const decisionOperations = aiOperations(
    {
      act: "stagehand.experimental_decisions_act",
      observe: "stagehand.experimental_decisions_observe",
      extract: "stagehand.experimental_decisions_extract",
    },
    (initParams, method) => {
      if (!initParams.experimentalDecisions) {
        throw new Error(
          `stagehand.experimentalDecisions.${method}() needs experimentalDecisions to be configured when Stagehand is created`,
        );
      }
      return decisionDrivers(initParams.experimentalDecisions);
    },
  );

  async function metrics(_params: EmptyParams, { logger }: HandlerContext) {
    logger.debug("stagehand.metrics", {});
    return runtime.metrics.snapshot();
  }

  return {
    init,
    close,
    ...llmOperations,
    experimentalDecisions: decisionOperations,
    metrics,
  };
}
