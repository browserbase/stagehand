import { test, expect } from "@playwright/test";
import { Stagehand } from "@browserbasehq/stagehand";
import StagehandConfig from "@/evals/deterministic/stagehand.config";
import { z } from "zod/v3";

let originalApiKey: string | undefined;

test.beforeAll(async () => {
  originalApiKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
});

test.afterAll(async () => {
  if (originalApiKey !== undefined) {
    process.env.OPENAI_API_KEY = originalApiKey;
  }
});

test.describe("API key/LLMClient error", () => {
  test("Should confirm that we get an error if we call extract without LLM API key or LLMClient", async () => {
    const stagehand = new Stagehand({
      ...StagehandConfig,
      llmClient: undefined,
      modelClientOptions: undefined,
    });
    await stagehand.init();
    await stagehand.page.goto("https://docs.browserbase.com/introduction");

    let errorThrown: Error | null = null;

    try {
      await stagehand.page.extract({
        instruction:
          "From the introduction page, extract the explanation of what Browserbase is.",
        schema: z.object({
          stars: z.string().describe("the explanation of what Browserbase is"),
        }),
      });
    } catch (error) {
      errorThrown = error as Error;
    }

    expect(errorThrown).toBeInstanceOf(Error);
    expect(
      errorThrown?.message?.includes(
        "No LLM API key or LLM Client configured",
      ) ||
        errorThrown?.message?.includes(
          "API key is missing. Pass it using the 'apiKey' parameter",
        ),
    ).toBe(true);

    await stagehand.close();
  });

  test("Should confirm that we get an error if we call act without LLM API key or LLMClient", async () => {
    const stagehand = new Stagehand({
      ...StagehandConfig,
      llmClient: undefined,
      modelClientOptions: undefined,
    });
    await stagehand.init();
    await stagehand.page.goto("https://docs.browserbase.com/introduction");

    let errorThrown: Error | null = null;

    try {
      await stagehand.page.act({
        action: "Click on the 'Quickstart' section",
      });
    } catch (error) {
      errorThrown = error as Error;
    }

    expect(errorThrown).toBeInstanceOf(Error);
    expect(
      errorThrown?.message?.includes(
        "No LLM API key or LLM Client configured",
      ) ||
        errorThrown?.message?.includes(
          "API key is missing. Pass it using the 'apiKey' parameter",
        ),
    ).toBe(true);

    await stagehand.close();
  });

  test("Should confirm that we get an error if we call observe without LLM API key or LLMClient", async () => {
    const stagehand = new Stagehand({
      ...StagehandConfig,
      llmClient: undefined,
      modelClientOptions: undefined,
    });
    await stagehand.init();
    await stagehand.page.goto("https://docs.browserbase.com/introduction");

    let errorThrown: Error | null = null;

    try {
      await stagehand.page.observe();
    } catch (error) {
      errorThrown = error as Error;
    }

    expect(errorThrown).toBeInstanceOf(Error);
    expect(
      errorThrown?.message?.includes(
        "No LLM API key or LLM Client configured",
      ) ||
        errorThrown?.message?.includes(
          "API key is missing. Pass it using the 'apiKey' parameter",
        ),
    ).toBe(true);

    await stagehand.close();
  });
});
