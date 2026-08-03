import { afterEach, describe, expect, it, vi } from "vitest";
import { StagehandInitParamsSchema, STAGEHAND_PROTOCOL_VERSION } from "../../protocol/schemas.js";
import { createStagehandController } from "../controllers/stagehandController.js";
import type { HandlerContext } from "../rpcRouter.js";
import { createStagehandRuntime } from "../runtime.js";
import * as actService from "../services/actService.js";
import * as extractService from "../services/extractService.js";
import * as observeService from "../services/observeService.js";
import { zeroStagehandResultUsage } from "../services/resultUsage.js";

const TIMEOUT_MS = 5;
type Operation = "act" | "observe" | "extract";

function createHarness() {
  const runtime = createStagehandRuntime();
  runtime.state.setState(
    {
      status: "initialized",
      initParams: StagehandInitParamsSchema.parse({
        protocolVersion: STAGEHAND_PROTOCOL_VERSION,
        clientInfo: { name: "stagehand-controller-test", version: "1.0.0" },
        model: { source: "client" },
        logLevel: "off",
      }),
    },
    true,
  );
  vi.spyOn(runtime, "resolvePage").mockReturnValue({} as never);
  vi.spyOn(runtime, "resolveUnderstudyPage").mockReturnValue({} as never);
  return {
    controller: createStagehandController(runtime),
    context: { logger: runtime.logger },
  };
}

function callOperation(
  controller: ReturnType<typeof createStagehandController>,
  context: HandlerContext,
  operation: Operation,
  timeout?: number,
) {
  const options = timeout === undefined ? undefined : { timeout };
  switch (operation) {
    case "act":
      return controller.act(
        {
          pageId: "page-1",
          instruction: "Click the button",
          ...(options ? { options } : {}),
        },
        context,
      );
    case "observe":
      return controller.observe({ pageId: "page-1", ...(options ? { options } : {}) }, context);
    case "extract":
      return controller.extract(
        {
          pageId: "page-1",
          instruction: "Extract the page",
          schema: { type: "object" },
          ...(options ? { options } : {}),
        },
        context,
      );
  }
}

function mockOperation(operation: Operation, result: Promise<unknown>) {
  switch (operation) {
    case "act":
      return vi.spyOn(actService, "act").mockReturnValue(result as never);
    case "observe":
      return vi.spyOn(observeService, "observe").mockReturnValue(result as never);
    case "extract":
      return vi.spyOn(extractService, "extract").mockReturnValue(result as never);
  }
}

describe("Stagehand controller timeouts", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(["act", "observe", "extract"] as const)(
    "applies the full-operation timeout to %s()",
    async (operation) => {
      const { controller, context } = createHarness();
      const pending = new Promise<never>(() => {});
      mockOperation(operation, pending);

      await expect(callOperation(controller, context, operation, TIMEOUT_MS)).rejects.toThrow(
        `${operation}() timed out after ${TIMEOUT_MS}ms`,
      );
    },
  );

  it.each(["act", "observe", "extract"] as const)(
    "passes through a successful %s() when timeout is omitted",
    async (operation) => {
      const { controller, context } = createHarness();
      const result = {
        data: { operation },
        metadata: { usage: zeroStagehandResultUsage() },
      };
      mockOperation(operation, Promise.resolve(result));

      await expect(callOperation(controller, context, operation)).resolves.toBe(result);
    },
  );
});
