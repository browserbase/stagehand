import type {
  EmptyParams,
  StagehandActParams,
  StagehandExtractParams,
  StagehandInitParams,
  StagehandObserveParams,
} from "../../protocol/types.js";
import { StagehandRuntimeError } from "../services/stagehandRuntimeService.js";
import type { StagehandRuntimeService } from "../services/stagehandRuntimeService.js";

type StagehandService = Pick<StagehandRuntimeService, "close">;

export function createStagehandController({ service }: { service: StagehandService }) {
  async function init(_params: StagehandInitParams): Promise<never> {
    console.log("[stagehand] stagehand.init");
    throw new StagehandRuntimeError(
      "Method not implemented by the smoke runtime",
      -32601,
      "stagehand.unknown_command",
    );
  }

  async function close(_params: EmptyParams) {
    console.log("[stagehand] stagehand.close");
    await service.close();
    return { closed: true as const };
  }

  async function act(_params: StagehandActParams): Promise<never> {
    console.log("[stagehand] stagehand.act");
    throw new StagehandRuntimeError(
      "Method not implemented by the smoke runtime",
      -32601,
      "stagehand.unknown_command",
    );
  }

  async function observe(_params: StagehandObserveParams): Promise<never> {
    console.log("[stagehand] stagehand.observe");
    throw new StagehandRuntimeError(
      "Method not implemented by the smoke runtime",
      -32601,
      "stagehand.unknown_command",
    );
  }

  async function extract(_params: StagehandExtractParams): Promise<never> {
    console.log("[stagehand] stagehand.extract");
    throw new StagehandRuntimeError(
      "Method not implemented by the smoke runtime",
      -32601,
      "stagehand.unknown_command",
    );
  }

  async function metrics(_params: EmptyParams): Promise<never> {
    console.log("[stagehand] stagehand.metrics");
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
