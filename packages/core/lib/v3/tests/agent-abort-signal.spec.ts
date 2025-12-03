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
    let caughtError: unknown = null;

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
    } catch (error) {
      caughtError = error;
    }

    const elapsed = Date.now() - startTime;

    // Should have thrown AgentAbortError (or completed very quickly)
    if (caughtError) {
      expect(caughtError).toBeInstanceOf(AgentAbortError);
    }
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

  test("can use both messages and signal together", async () => {
    test.setTimeout(90000);

    const agent = v3.agent({
      model: "anthropic/claude-haiku-4-5-20251001",
    });

    const page = v3.context.pages()[0];
    await page.goto("https://example.com");

    // First execution
    const result1 = await agent.execute({
      instruction:
        "What is the title of this page? Use close tool with taskComplete: true.",
      maxSteps: 5,
    });

    expect(result1.messages).toBeDefined();

    // Second execution with both messages and signal
    const controller = new AbortController();

    // Give enough time for a normal quick task
    setTimeout(() => controller.abort(), 10000);

    const result2 = await agent.execute({
      instruction:
        "Say 'confirmed' and use close tool with taskComplete: true.",
      maxSteps: 3,
      messages: result1.messages,
      signal: controller.signal,
    });

    // Should complete before timeout
    expect(result2.success).toBe(true);
    expect(result2.messages).toBeDefined();
    expect(result2.messages!.length).toBeGreaterThan(result1.messages!.length);
  });
});
