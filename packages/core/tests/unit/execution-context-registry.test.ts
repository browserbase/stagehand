import { describe, expect, it } from "vitest";
import type { Protocol } from "devtools-protocol";
import {
  DEFAULT_MAIN_WORLD_TIMEOUT_MS,
  ExecutionContextRegistry,
} from "../../lib/v3/understudy/executionContextRegistry.js";
import { MockCDPSession } from "./helpers/mockCDPSession.js";

function executionContextCreated(
  frameId: string,
  id: number,
): Protocol.Runtime.ExecutionContextCreatedEvent {
  return {
    context: {
      id,
      origin: "",
      name: "",
      uniqueId: `ctx-${id}`,
      auxData: { frameId, isDefault: true },
    },
  };
}

describe("ExecutionContextRegistry.waitForMainWorld", () => {
  it("exports a 15s default timeout", () => {
    expect(DEFAULT_MAIN_WORLD_TIMEOUT_MS).toBe(15_000);
  });

  it("resolves when execution context is created", async () => {
    const registry = new ExecutionContextRegistry();
    const session = new MockCDPSession();
    registry.attachSession(session);

    const frameId = "FRAME-1" as Protocol.Page.FrameId;
    const wait = registry.waitForMainWorld(session, frameId, 2000);

    session.emit(
      "Runtime.executionContextCreated",
      executionContextCreated(frameId, 7) as unknown as Record<
        string,
        unknown
      >,
    );

    await expect(wait).resolves.toBe(7);
  });

  it("returns cached execution context immediately", async () => {
    const registry = new ExecutionContextRegistry();
    const session = new MockCDPSession();
    registry.attachSession(session);

    const frameId = "FRAME-2" as Protocol.Page.FrameId;
    session.emit(
      "Runtime.executionContextCreated",
      executionContextCreated(frameId, 9) as unknown as Record<
        string,
        unknown
      >,
    );

    const wait = registry.waitForMainWorld(session, frameId, 2000);
    await expect(wait).resolves.toBe(9);
  });

  it("rejects after timeout when no execution context appears", async () => {
    const registry = new ExecutionContextRegistry();
    const session = new MockCDPSession();
    const frameId = "FRAME-3" as Protocol.Page.FrameId;

    await expect(
      registry.waitForMainWorld(session, frameId, 50),
    ).rejects.toThrow("main world not ready for frame FRAME-3");
  });
});
