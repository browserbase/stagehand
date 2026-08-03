import { z } from "zod/v4";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ClientLLM, Stagehand } from "../../src/index.js";
import { closeStagehand, createStagehand, firstPage } from "./_support.js";

const hangingModel: ClientLLM = {
  generate: () => new Promise<never>(() => {}),
};

describe("Stagehand operation timeouts", () => {
  let stagehand: Stagehand;

  beforeEach(async () => {
    stagehand = await createStagehand({ model: hangingModel });
    const page = await firstPage(stagehand);
    await page.goto("data:text/html,<button>Continue</button><h1>Timeout fixture</h1>");
  });

  afterEach(async () => {
    await closeStagehand(stagehand);
  });

  it("observe() enforces timeout", async () => {
    await expect(stagehand.observe("find something", { timeout: 5 })).rejects.toThrow(/timed out/i);
  }, 5_000);

  it("extract() enforces timeout", async () => {
    await expect(
      stagehand.extract("Extract title", z.object({ title: z.string() }), { timeout: 5 }),
    ).rejects.toThrow(/timed out/i);
  }, 5_000);

  it("act() enforces timeout", async () => {
    await expect(stagehand.act("click Continue", { timeout: 5 })).rejects.toThrow(/timed out/i);
  }, 5_000);
});
