import { describe, expect, it, vi } from "vitest";
import { createAgentTools } from "../../lib/v3/agent/tools/index.js";
import type { V3 } from "../../lib/v3/v3.js";

function createMockV3() {
  let concurrentActs = 0;
  let maxConcurrentActs = 0;
  const callOrder: string[] = [];

  const mock = {
    logger: vi.fn(),
    recordAgentReplayStep: vi.fn(),
    act: vi.fn(async (instruction: string) => {
      concurrentActs += 1;
      maxConcurrentActs = Math.max(maxConcurrentActs, concurrentActs);
      callOrder.push(`start:${instruction}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
      callOrder.push(`end:${instruction}`);
      concurrentActs -= 1;
      return {
        success: true,
        message: "ok",
        actionDescription: instruction,
        actions: [],
      };
    }),
  };

  return {
    v3: mock as unknown as V3,
    getMaxConcurrentActs: () => maxConcurrentActs,
    callOrder,
  };
}

describe("agent tool execution queue", () => {
  it("serializes concurrent DOM tool executions against the same agent", async () => {
    const { v3, getMaxConcurrentActs, callOrder } = createMockV3();
    const tools = createAgentTools(v3, { mode: "dom" });

    const context = (toolCallId: string) => ({
      toolCallId,
      messages: [] as never[],
      abortSignal: new AbortController().signal,
    });

    await Promise.all([
      tools.act.execute?.({ action: "click first button" }, context("t1")),
      tools.act.execute?.({ action: "click second button" }, context("t2")),
    ]);

    expect(getMaxConcurrentActs()).toBe(1);
    expect(callOrder).toEqual([
      "start:click first button",
      "end:click first button",
      "start:click second button",
      "end:click second button",
    ]);
  });
});
