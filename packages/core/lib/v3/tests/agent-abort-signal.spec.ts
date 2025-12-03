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

  test("abort signal stops execution and throws AgentAbortError", async () => {
    test.setTimeout(30000);

    const agent = v3.agent({
      model: "anthropic/claude-haiku-4-5-20251001",
    });

    const page = v3.context.pages()[0];
    await page.goto("https://example.com");

    const controller = new AbortController();

    // Abort after a short delay
    setTimeout(() => controller.abort(), 500);

    const startTime = Date.now();

    try {
      await agent.execute({
        instruction:
          "Describe everything on this page in extreme detail. Take your time and be very thorough. Do not use close tool until you have described every single element.",
        maxSteps: 50,
        signal: controller.signal,
      });
      // Should not reach here
      expect(true).toBe(false);
    } catch (error) {
      // Should throw AgentAbortError
      expect(error).toBeInstanceOf(AgentAbortError);
      expect((error as AgentAbortError).reason).toContain("aborted");
    }

    const elapsed = Date.now() - startTime;

    // Should have stopped relatively quickly (within a few seconds of abort)
    // Not waiting for all 50 steps
    expect(elapsed).toBeLessThan(15000);
  });

  test("AbortSignal.timeout throws AgentAbortError", async () => {
    test.setTimeout(30000);

    const agent = v3.agent({
      model: "anthropic/claude-haiku-4-5-20251001",
    });

    const page = v3.context.pages()[0];
    await page.goto("https://example.com");

    const startTime = Date.now();

    try {
      await agent.execute({
        instruction:
          "Describe everything on this page in extreme detail. Take your time. Do not use close tool until done.",
        maxSteps: 50,
        signal: AbortSignal.timeout(1000), // 1 second timeout
      });
      // Should not reach here
      expect(true).toBe(false);
    } catch (error) {
      // Should throw AgentAbortError
      expect(error).toBeInstanceOf(AgentAbortError);
    }

    const elapsed = Date.now() - startTime;

    // Should have stopped around the timeout (with some margin)
    expect(elapsed).toBeLessThan(10000);
  });

  test("streaming mode throws AgentAbortError on abort", async () => {
    test.setTimeout(90000);

    const agent = v3.agent({
      stream: true,
      model: "anthropic/claude-haiku-4-5-20251001",
    });

    const page = v3.context.pages()[0];
    await page.goto("https://example.com");

    // Use AbortSignal.timeout for more reliable abort
    const signal = AbortSignal.timeout(2000); // 2 second timeout

    const startTime = Date.now();

    try {
      const streamResult = await agent.execute({
        instruction:
          "Describe everything on this page in extreme detail. Take your time and list every single element.",
        maxSteps: 50,
        signal,
      });

      // Try to consume the stream
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of streamResult.textStream) {
        // Just consume - abort should interrupt this
      }
      await streamResult.result;

      // If we reach here without throwing, the test failed to verify abort behavior
      throw new Error("Expected AgentAbortError to be thrown due to timeout");
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "Expected AgentAbortError to be thrown due to timeout"
      ) {
        throw error; // Re-throw our own error
      }
      // Should throw AgentAbortError
      expect(error).toBeInstanceOf(AgentAbortError);
    }

    const elapsed = Date.now() - startTime;

    // Should have stopped within reasonable time (not running all 50 steps)
    expect(elapsed).toBeLessThan(30000);
  });

  test("execution completes normally without abort signal", async () => {
    test.setTimeout(60000);

    const agent = v3.agent({
      model: "anthropic/claude-haiku-4-5-20251001",
    });

    const page = v3.context.pages()[0];
    await page.goto("https://example.com");

    // No signal provided - should complete normally
    const result = await agent.execute({
      instruction: "Use close tool with taskComplete: true immediately.",
      maxSteps: 3,
    });

    expect(result.success).toBe(true);
    expect(result.completed).toBe(true);
  });

  test("already aborted signal throws AgentAbortError immediately", async () => {
    test.setTimeout(10000);

    const agent = v3.agent({
      model: "anthropic/claude-haiku-4-5-20251001",
    });

    const page = v3.context.pages()[0];
    await page.goto("https://example.com");

    // Create an already aborted controller
    const controller = new AbortController();
    controller.abort();

    try {
      await agent.execute({
        instruction: "This should not run.",
        maxSteps: 3,
        signal: controller.signal,
      });
      // Should not reach here
      expect(true).toBe(false);
    } catch (error) {
      // Should throw AgentAbortError immediately
      expect(error).toBeInstanceOf(AgentAbortError);
    }
  });

  test("stagehand.close() aborts running agent tasks", async () => {
    test.setTimeout(30000);

    // Create a separate instance for this test to avoid interfering with afterEach
    const v3Instance = new V3({
      ...v3TestConfig,
      experimental: true,
    });
    await v3Instance.init();

    const agent = v3Instance.agent({
      model: "anthropic/claude-haiku-4-5-20251001",
    });

    const page = v3Instance.context.pages()[0];
    await page.goto("https://example.com");

    const startTime = Date.now();

    // Start a long-running task and close() after a short delay
    const executePromise = agent.execute({
      instruction:
        "Describe everything on this page in extreme detail. Take your time and be very thorough. Do not use close tool until you have described every single element.",
      maxSteps: 50,
    });

    // Close after a short delay - this should abort the running task
    setTimeout(() => {
      v3Instance.close().catch(() => {});
    }, 500);

    try {
      await executePromise;
      // Should not reach here
      expect(true).toBe(false);
    } catch (error) {
      // Should throw AgentAbortError due to close()
      expect(error).toBeInstanceOf(AgentAbortError);
      expect((error as AgentAbortError).reason).toContain("closing");
    }

    const elapsed = Date.now() - startTime;

    // Should have stopped relatively quickly after close()
    expect(elapsed).toBeLessThan(15000);
  });
});
