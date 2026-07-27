import type { EmptyParams } from "../../protocol/types.js";
import type { HandlerContext } from "../rpcRouter.js";
import type { StagehandRuntime } from "../runtime.js";

export function createRuntimeController(runtime: StagehandRuntime) {
  async function ping(_params: EmptyParams, { logger }: HandlerContext) {
    logger.debug("ping", {});
    return {
      ok: true as const,
      runtime: "service_worker" as const,
    };
  }

  return {
    ping,
  };
}
