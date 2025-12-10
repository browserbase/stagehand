import { test, expect } from "@playwright/test";
import { V3 } from "../v3";
import { v3TestConfig } from "./v3.config";
import { AgentAbortError } from "../types/public/sdkErrors";

test.describe("Stagehand agent abort signal", () => {
  let v3: V3;

  test.beforeEach(async () => {
    v3 = new V3({
      ...v3TestConfig,
      experimental: true,
    });
    await v3.init();
  });

  test.afterEach(async () => {
    await v3?.close?.().catch(() => {});
  });

  test("non-streaming: abort signal stops execution and throws AgentAbortError", async () => {
    test.setTimeout(60000);

    const agent = v3.agent({
      model: "anthropic/claude-haiku-4-5-20251001",
    });

    const page = v3.context.pages()[0];
    await page.goto("https://example.com");

    const controller = new AbortController();

    // Abort after 500ms - should be enough for the LLM to start but not finish
    setTimeout(() => controller.abort(), 500);

    await expect(
      agent.execute({
        instruction:
          "Describe every visual element on this page in extreme detail. Do not use the close tool until you have described at least 100 different elements.",
        maxSteps: 50,
        signal: controller.signal,
      }),
    ).rejects.toThrow(AgentAbortError);
  });

  test("streaming: abort signal stops stream and rejects result with AgentAbortError", async () => {
    test.setTimeout(60000);

    const agent = v3.agent({
      stream: true,
      model: "anthropic/claude-haiku-4-5-20251001",
    });

    const page = v3.context.pages()[0];
    await page.goto("https://example.com");

    const controller = new AbortController();

    // Abort after 500ms
    setTimeout(() => controller.abort(), 500);

    const streamResult = await agent.execute({
      instruction:
        "Describe every visual element on this page in extreme detail. Do not use the close tool until you have described at least 100 different elements.",
      maxSteps: 50,
      signal: controller.signal,
    });

    // Handle both stream consumption and result promise together
    // The result promise will reject with AgentAbortError when aborted
    const consumeStream = async () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of streamResult.textStream) {
        // Just consume chunks until stream ends
      }
    };

    // Both should complete - stream ends and result rejects
    const [, resultError] = await Promise.allSettled([
      consumeStream(),
      streamResult.result,
    ]);

    // The result should have rejected with AgentAbortError
    expect(resultError.status).toBe("rejected");
    expect((resultError as PromiseRejectedResult).reason).toBeInstanceOf(
      AgentAbortError,
    );
  });

  test("non-streaming: already aborted signal throws AgentAbortError immediately", async () => {
    test.setTimeout(20000);

    const agent = v3.agent({
      model: "anthropic/claude-haiku-4-5-20251001",
    });

    const page = v3.context.pages()[0];
    await page.goto("https://example.com");

    // Create an already aborted controller
    const controller = new AbortController();
    controller.abort();

    await expect(
      agent.execute({
        instruction: "This should not run.",
        maxSteps: 3,
        signal: controller.signal,
      }),
    ).rejects.toThrow(AgentAbortError);
  });

  test("non-streaming: execution completes normally without abort signal", async () => {
    test.setTimeout(60000);

    const agent = v3.agent({
      model: "anthropic/claude-haiku-4-5-20251001",
    });

    const page = v3.context.pages()[0];
    await page.goto("https://example.com");

    // No signal provided - should complete normally
    const result = await agent.execute({
      instruction: "Use the close tool with taskComplete: true immediately.",
      maxSteps: 3,
    });

    expect(result.success).toBe(true);
    expect(result.completed).toBe(true);
  });

  test("streaming: execution completes normally without abort signal", async () => {
    test.setTimeout(60000);

    const agent = v3.agent({
      stream: true,
      model: "anthropic/claude-haiku-4-5-20251001",
    });

    const page = v3.context.pages()[0];
    await page.goto("https://example.com");

    // No signal provided - should complete normally
    const streamResult = await agent.execute({
      instruction: "Use the close tool with taskComplete: true immediately.",
      maxSteps: 3,
    });

    // Consume the stream first
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ of streamResult.textStream) {
      // Just consume
    }

    // Now get the final result
    const result = await streamResult.result;

    expect(result.success).toBe(true);
    expect(result.completed).toBe(true);
  });
});
