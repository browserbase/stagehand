import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Stagehand } from "../../src/index.js";
import { closeStagehand, createStagehand, firstPage } from "./_support.js";

describe("CDP session detach handling", () => {
  let stagehand: Stagehand;

  beforeAll(async () => {
    stagehand = await createStagehand();
  });

  afterAll(async () => {
    await closeStagehand(stagehand);
  });

  it("rejects inflight page evaluations when a target is closed", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);

    try {
      const page = await firstPage(stagehand);
      await page.goto("data:text/html,<html><body>cdp</body></html>");

      const pending = page.evaluate(
        "new Promise(resolve => setTimeout(() => resolve('done'), 5000))",
      );
      const rejected = expect(pending).rejects.toThrow(
        /No Page found for target closed before CDP response/,
      );
      await page.close();

      await rejected;
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(unhandled).toHaveLength(0);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
