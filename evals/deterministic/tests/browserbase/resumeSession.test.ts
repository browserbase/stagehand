import { expect, test } from "@playwright/test";
import { Stagehand } from "@/dist";
import Browserbase from "@browserbasehq/sdk";
import StagehandConfig from "@/evals/deterministic/stagehand.config";

test.describe("Stagehand - resume Browserbase Session", () => {
  test("should resume an existing BB session", async () => {
    const bb = new Browserbase();
    const session = await bb.sessions.create({
      projectId: process.env.BROWSERBASE_PROJECT_ID,
    });
    const stagehand = new Stagehand({
      ...StagehandConfig,
      browserbaseSessionID: session.id,
    });
    await stagehand.init();
    expect(stagehand.browserbaseSessionID).toBe(session.id);

    const page = stagehand.page;
    const url = "https://docs.stagehand.dev/get_started/introduction";
    await page.goto(url);
    expect(page.url()).toBe(url);

    await stagehand.close();
  });
});
