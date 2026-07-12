import type { EmptyParams, RuntimeConfigureParams } from "../../protocol/types.js";
import type { StagehandRuntimeService } from "../services/stagehandRuntimeService.js";

type RuntimeService = Pick<StagehandRuntimeService, "configureLoopback" | "loopbackStatus">;

export function createRuntimeController({ service }: { service: RuntimeService }) {
  async function ping(_params: EmptyParams) {
    console.log("[stagehand] ping");
    return {
      ok: true as const,
      runtime: "service_worker" as const,
    };
  }

  async function configure(params: RuntimeConfigureParams) {
    console.log("[stagehand] runtime.configure");
    return service.configureLoopback(params);
  }

  async function loopbackStatus(_params: EmptyParams) {
    console.log("[stagehand] runtime.loopback_status");
    return service.loopbackStatus();
  }

  return {
    ping,
    configure,
    loopbackStatus,
  };
}
