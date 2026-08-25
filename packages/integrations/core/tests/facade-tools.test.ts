import type { Stagehand } from "@browserbasehq/stagehand";
import { describe, expect, it, vi } from "vitest";

import { StagehandFacadeTools } from "../src/facade/tools.js";

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
