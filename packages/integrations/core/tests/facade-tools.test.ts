import type { Stagehand } from "@browserbasehq/stagehand";
import { describe, expect, it, vi } from "vitest";

import { StagehandFacadeCleanupError, StagehandFacadeTools } from "../src/facade/tools.js";

describe("StagehandFacadeTools", () => {
  it("propagates browser.close requests to host cleanup", async () => {
    const onCloseRequested = vi.fn(async () => undefined);
    const { experimentalBatch, stagehand } = createStagehand({
      __stagehandPlaywrightCompat: true,
      value: "closed",
      closeRequested: true,
    });
    const tools = new StagehandFacadeTools(stagehand, { onCloseRequested });

    await expect(tools.run('await browser.close(); return "closed";')).resolves.toBe("closed");
    expect(onCloseRequested).toHaveBeenCalledOnce();

    const callback = (experimentalBatch.mock.calls as unknown[][])[0]?.[0];
    expect(String(callback)).toContain("closeRequested: runtime.closeRequested()");
  });

  it("closes before surfacing a model-authored error", async () => {
    const onCloseRequested = vi.fn(async () => undefined);
    const { stagehand } = createStagehand({
      __stagehandPlaywrightCompat: true,
      value: undefined,
      closeRequested: true,
      executionError: { name: "Error", message: "boom" },
    });
    const tools = new StagehandFacadeTools(stagehand, { onCloseRequested });

    await expect(tools.run('await browser.close(); throw new Error("boom");')).rejects.toThrow(
      "boom",
    );
    expect(onCloseRequested).toHaveBeenCalledOnce();
  });

  it("sanitizes model errors and cleanup errors when both fail", async () => {
    const onCloseRequested = vi.fn(async () => {
      throw new Error("provider rejected bb_live_1234secret");
    });
    const { stagehand } = createStagehand({
      __stagehandPlaywrightCompat: true,
      value: undefined,
      closeRequested: true,
      executionError: {
        name: "TypeError",
        message: "model failed with sk-123456secret",
        stack: "raw worker stack bb_live_1234secret",
      },
    });
    const tools = new StagehandFacadeTools(stagehand, { onCloseRequested });

    const error = await tools.run("throw new TypeError('failed');").catch((caught) => caught);
    expect(error).toBeInstanceOf(AggregateError);
    if (!(error instanceof AggregateError)) throw new Error("Expected AggregateError");
    expect(error.cause).toBeUndefined();
    expect(error.errors).toHaveLength(2);
    expect(error.errors[0]).toMatchObject({
      name: "TypeError",
      message: "model failed with sk-123456[redacted]",
      stack: undefined,
    });
    expect(error.errors[1]).toBeInstanceOf(StagehandFacadeCleanupError);
    expect(error.errors.map(String).join("\n")).not.toContain("secret");
  });

  it("uses a fixed cleanup error when host cleanup fails", async () => {
    const onCloseRequested = vi.fn(async () => {
      throw new Error("provider rejected bb_live_1234secret");
    });
    const { stagehand } = createStagehand({
      __stagehandPlaywrightCompat: true,
      value: "closed",
      closeRequested: true,
    });
    const tools = new StagehandFacadeTools(stagehand, { onCloseRequested });

    await expect(tools.run('await browser.close(); return "closed";')).rejects.toEqual(
      new StagehandFacadeCleanupError(),
    );
  });

  it("reports an unsupported host instead of dropping a close request", async () => {
    const { stagehand } = createStagehand({
      __stagehandPlaywrightCompat: true,
      value: "closed",
      closeRequested: true,
    });
    const tools = new StagehandFacadeTools(stagehand);

    await expect(tools.run('await browser.close(); return "closed";')).rejects.toBeInstanceOf(
      StagehandFacadeCleanupError,
    );
  });
});

function createStagehand(envelope: Record<string, unknown>) {
  const page = { pageId: "page-1", url: vi.fn(async () => "https://example.com") };
  const experimentalBatch = vi.fn(async () => envelope);
  const stagehand = {
    browser: { context: { activePage: vi.fn(async () => page) } },
    experimentalBatch,
  } as unknown as Stagehand;
  return { experimentalBatch, stagehand };
}
