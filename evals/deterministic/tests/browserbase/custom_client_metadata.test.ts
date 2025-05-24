/**
 * Just extends sessions.test.ts but with a custom client.
 */
import { test, expect } from "@playwright/test";
import { Stagehand } from "@browserbasehq/stagehand";
import StagehandConfig from "@/evals/deterministic/stagehand.config";
import Browserbase from "@browserbasehq/sdk";
import { AISdkClient } from "@/examples/external_clients/aisdk";
import { google } from "@ai-sdk/google/dist";

test.describe("Browserbase Sessions with custom client metadata", () => {
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
      modelName: undefined,
      llmClient: new AISdkClient({
        model: google("gemini-2.0-flash"),
      }),
    });
    await bigStagehand.init();
    await bigStagehand.page.goto(
      "https://docs.stagehand.dev/get_started/introduction",
    );
    sessionId = bigStagehand.browserbaseSessionID;
    if (!sessionId) {
      throw new Error("Failed to get browserbase session ID");
    }
  });
  test.afterAll(async () => {
    await bigStagehand.close();
  });
  test("creates the right session metadata", async () => {
    const session = await browserbase.sessions.retrieve(sessionId);
    expect(session.userMetadata.stagehand).toBe("true");
    expect(session.userMetadata.modelName).toBe("NO_MODEL_DEFINED");
    expect(session.userMetadata.usingCustomClient).toBe("true");
  });
});
