import { test, expect } from "@playwright/test";
import { Stagehand } from "@browserbasehq/stagehand";
import StagehandConfig from "@/evals/deterministic/stagehand.config";
import Browserbase from "@browserbasehq/sdk";

test.describe("Browserbase Sessions", () => {
  let browserbase: Browserbase;
  let sessionId: string;
  let bigStagehand: Stagehand;

  test.beforeAll(async () => {
    browserbase = new Browserbase({
      apiKey: process.env.BROWSERBASE_API_KEY,
    });
    bigStagehand = new Stagehand({
      ...StagehandConfig,
      env: "BROWSERBASE",
      useAPI: false,
      browserbaseSessionCreateParams: {
        projectId: process.env.BROWSERBASE_PROJECT_ID,
        keepAlive: true,
      },
    });
    await bigStagehand.init();
    await bigStagehand.page.goto(
      "https://docs.stagehand.dev/first-steps/introduction",
    );
    sessionId = bigStagehand.browserbaseSessionID;
    if (!sessionId) {
      throw new Error("Failed to get browserbase session ID");
    }
  });
  test.afterAll(async () => {
    await bigStagehand.close();
  });
  test("resumes a session via sessionId", async () => {
    const stagehand = new Stagehand({
      ...StagehandConfig,
      useAPI: false,
      env: "BROWSERBASE",
      browserbaseSessionID: sessionId,
    });
    await stagehand.init();

    const page = stagehand.page;

    expect(page.url()).toBe(
      "https://docs.stagehand.dev/first-steps/introduction",
    );
  });
  test("resumes a session via CDP URL", async () => {
    const session = await browserbase.sessions.retrieve(sessionId);

    const stagehand = new Stagehand({
      ...StagehandConfig,
      env: "LOCAL",
      localBrowserLaunchOptions: {
        headless: true,
        cdpUrl: session.connectUrl,
      },
    });
    await stagehand.init();
    const page = stagehand.page;

    expect(page.url()).toBe(
      "https://docs.stagehand.dev/first-steps/introduction",
    );
  });
});
