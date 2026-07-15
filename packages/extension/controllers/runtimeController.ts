import type { EmptyParams, RuntimeConfigureParams } from "../../protocol/types.js";
import type { HandlerContext } from "../rpcRouter.js";
import type { StagehandRuntime } from "../runtime.js";

export function createRuntimeController(runtime: StagehandRuntime) {
  async function ping(_params: EmptyParams, { logger }: HandlerContext) {
    logger.info("[stagehand] ping", {});
    return {
      ok: true as const,
      runtime: "service_worker" as const,
    };
  }

  async function configure(params: RuntimeConfigureParams, { logger }: HandlerContext) {
    logger.info("[stagehand] runtime.configure", {});
    runtime.tracing.configure(params.telemetry);
    return runtime.configureLoopback(params);
  }

  async function loopbackStatus(_params: EmptyParams, { logger }: HandlerContext) {
    logger.info("[stagehand] runtime.loopback_status", {});
    return runtime.loopbackStatus();
  }

  return {
    ping,
    configure,
    loopbackStatus,
  };
}
