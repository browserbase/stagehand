import type { RuntimeConfigureParams } from "../../protocol/types.js";
import type { HandlerContext } from "../rpcRouter.js";
import type { StagehandRuntime } from "../runtime.js";

export function createRuntimeController(runtime: StagehandRuntime) {
  async function configure(params: RuntimeConfigureParams, { logger }: HandlerContext) {
    logger.setLevel(params.logLevel);
    logger.debug("runtime.configure", {});
    runtime.tracing.configure(params.telemetry);
    return runtime.configureLoopback(params);
  }

  return {
    configure,
  };
}
