import { test, expect } from "@playwright/test";
import { V3 } from "../v3";
import { v3TestConfig } from "./v3.config";
import type { StepResult, ToolSet } from "ai";
import { StreamingCallbacksInNonStreamingModeError } from "../types/public/sdkErrors";

test.describe("Stagehand agent callbacks behavior", () => {
  let v3: V3;

  test.beforeEach(async () => {
    v3 = new V3({
      ...v3TestConfig,
      experimental: true, // Required for callbacks and streaming
    });
    await v3.init();
  });

  test.afterEach(async () => {
    await v3?.close?.().catch(() => {});
  });

  test.describe("Non-streaming callbacks (stream: false)", () => {
    test("onStepFinish callback is called for each step", async () => {
      test.setTimeout(60000);

      const stepFinishEvents: StepResult<ToolSet>[] = [];

      const agent = v3.agent({
        model: "anthropic/claude-haiku-4-5-20251001",
      });

      const page = v3.context.pages()[0];
      await page.goto("https://example.com");

      await agent.execute({
        instruction:
          "What is the title of this page? Use close tool with taskComplete: true immediately after answering.",
        maxSteps: 5,
        callbacks: {
          onStepFinish: async (event) => {
            stepFinishEvents.push(event);
          },
        },
      });

      // Should have at least one step finish event
      expect(stepFinishEvents.length).toBeGreaterThan(0);

      // Each event should have expected properties
      for (const event of stepFinishEvents) {
        expect(event).toHaveProperty("finishReason");
        expect(event).toHaveProperty("text");
      }
    });

    test("prepareStep callback is called before each step", async () => {
      test.setTimeout(60000);

      let prepareStepCallCount = 0;

      const agent = v3.agent({
        model: "anthropic/claude-haiku-4-5-20251001",
      });

      const page = v3.context.pages()[0];
      await page.goto("https://example.com");

      await agent.execute({
        instruction: "Use close tool with taskComplete: true immediately.",
        maxSteps: 3,
        callbacks: {
          prepareStep: async (stepContext) => {
            prepareStepCallCount++;
            return stepContext;
          },
        },
      });

      // prepareStep should have been called at least once
      expect(prepareStepCallCount).toBeGreaterThan(0);
    });

    test("callbacks receive tool call information", async () => {
      test.setTimeout(60000);

      const toolCalls: Array<{ toolName: string; input: unknown }> = [];

      const agent = v3.agent({
        model: "anthropic/claude-haiku-4-5-20251001",
      });

      const page = v3.context.pages()[0];
      await page.goto("https://example.com");

      await agent.execute({
        instruction:
          "Take a screenshot and describe what you see briefly. Then mark the task as complete.",
        maxSteps: 3,
        callbacks: {
          onStepFinish: async (event) => {
            if (event.toolCalls) {
              for (const tc of event.toolCalls) {
                toolCalls.push({
                  toolName: tc.toolName,
                  input: tc.input,
                });
              }
            }
          },
        },
      });

      // Should have captured at least one tool call (e.g. screenshot)
      expect(toolCalls.length).toBeGreaterThan(0);
      expect(
        toolCalls.some(
          (tc) => tc.toolName === "screenshot" || tc.toolName === "ariaTree",
        ),
      ).toBe(true);
    });
  });

  test.describe("Streaming callbacks (stream: true)", () => {
    test("onStepFinish callback is called for each step in stream mode", async () => {
      test.setTimeout(60000);

      const stepFinishEvents: StepResult<ToolSet>[] = [];

      const agent = v3.agent({
        stream: true,
        model: "anthropic/claude-haiku-4-5-20251001",
      });

      const page = v3.context.pages()[0];
      await page.goto("https://example.com");

      const streamResult = await agent.execute({
        instruction:
          "What is this page? Use close tool with taskComplete: true after answering.",
        maxSteps: 5,
        callbacks: {
          onStepFinish: async (event) => {
            stepFinishEvents.push(event);
          },
        },
      });

      // Consume the stream
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of streamResult.textStream) {
        // Just consume
      }

      // Wait for result to complete
      await streamResult.result;

      // Should have at least one step finish event
      expect(stepFinishEvents.length).toBeGreaterThan(0);
    });

    test("onChunk callback is called for each chunk", async () => {
      test.setTimeout(60000);

      let chunkCount = 0;

      const agent = v3.agent({
        stream: true,
        model: "anthropic/claude-haiku-4-5-20251001",
      });

      const page = v3.context.pages()[0];
      await page.goto("https://example.com");

      const streamResult = await agent.execute({
        instruction:
          "Say hello and then use close tool with taskComplete: true",
        maxSteps: 3,
        callbacks: {
          onChunk: async () => {
            chunkCount++;
          },
        },
      });

      // Consume the stream
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of streamResult.textStream) {
        // Just consume
      }

      await streamResult.result;

      // Should have received chunks
      expect(chunkCount).toBeGreaterThan(0);
    });

    test("onFinish callback is called when stream completes", async () => {
      test.setTimeout(60000);

      let finishCalled = false;
      let finishEvent: unknown = null;

      const agent = v3.agent({
        stream: true,
        model: "anthropic/claude-haiku-4-5-20251001",
      });

      const page = v3.context.pages()[0];
      await page.goto("https://example.com");

      const streamResult = await agent.execute({
        instruction: "Use close tool with taskComplete: true immediately.",
        maxSteps: 3,
        callbacks: {
          onFinish: (event) => {
            finishCalled = true;
            finishEvent = event;
          },
        },
      });

      // Consume the stream
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of streamResult.textStream) {
        // Just consume
      }

      await streamResult.result;

      // onFinish should have been called
      expect(finishCalled).toBe(true);
      expect(finishEvent).not.toBeNull();
    });

    test("prepareStep callback works in stream mode", async () => {
      test.setTimeout(60000);

      let prepareStepCallCount = 0;

      const agent = v3.agent({
        stream: true,
        model: "anthropic/claude-haiku-4-5-20251001",
      });

      const page = v3.context.pages()[0];
      await page.goto("https://example.com");

      const streamResult = await agent.execute({
        instruction: "Use close tool with taskComplete: true immediately.",
        maxSteps: 3,
        callbacks: {
          prepareStep: async (stepContext) => {
            prepareStepCallCount++;
            return stepContext;
          },
        },
      });

      // Consume the stream
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of streamResult.textStream) {
        // Just consume
      }

      await streamResult.result;

      // prepareStep should have been called at least once
      expect(prepareStepCallCount).toBeGreaterThan(0);
    });
  });

  test.describe("Streaming-only callbacks runtime validation", () => {
    test("throws StreamingCallbacksInNonStreamingModeError when onChunk is used", async () => {
      const agent = v3.agent({
        model: "anthropic/claude-haiku-4-5-20251001",
      });

      const page = v3.context.pages()[0];
      await page.goto("https://example.com");

      try {
        await agent.execute({
          instruction: "test",
          callbacks: {
            onChunk: (() => {}) as never,
          },
        });
        throw new Error("Expected error to be thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(StreamingCallbacksInNonStreamingModeError);
        expect(
          (error as StreamingCallbacksInNonStreamingModeError).invalidCallbacks,
        ).toEqual(["onChunk"]);
      }
    });

    test("throws StreamingCallbacksInNonStreamingModeError when onFinish is used", async () => {
      const agent = v3.agent({
        model: "anthropic/claude-haiku-4-5-20251001",
      });

      const page = v3.context.pages()[0];
      await page.goto("https://example.com");

      try {
        await agent.execute({
          instruction: "test",
          callbacks: {
            onFinish: (() => {}) as never,
          },
        });
        throw new Error("Expected error to be thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(StreamingCallbacksInNonStreamingModeError);
        expect(
          (error as StreamingCallbacksInNonStreamingModeError).invalidCallbacks,
        ).toEqual(["onFinish"]);
      }
    });

    test("throws StreamingCallbacksInNonStreamingModeError when onError is used", async () => {
      const agent = v3.agent({
        model: "anthropic/claude-haiku-4-5-20251001",
      });

      const page = v3.context.pages()[0];
      await page.goto("https://example.com");

      try {
        await agent.execute({
          instruction: "test",
          callbacks: {
            onError: (() => {}) as never,
          },
        });
        throw new Error("Expected error to be thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(StreamingCallbacksInNonStreamingModeError);
        expect(
          (error as StreamingCallbacksInNonStreamingModeError).invalidCallbacks,
        ).toEqual(["onError"]);
      }
    });

    test("throws StreamingCallbacksInNonStreamingModeError when onAbort is used", async () => {
      const agent = v3.agent({
        model: "anthropic/claude-haiku-4-5-20251001",
      });

      const page = v3.context.pages()[0];
      await page.goto("https://example.com");

      try {
        await agent.execute({
          instruction: "test",
          callbacks: {
            onAbort: (() => {}) as never,
          },
        });
        throw new Error("Expected error to be thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(StreamingCallbacksInNonStreamingModeError);
        expect(
          (error as StreamingCallbacksInNonStreamingModeError).invalidCallbacks,
        ).toEqual(["onAbort"]);
      }
    });

    test("error includes all invalid callbacks when multiple are used", async () => {
      const agent = v3.agent({
        model: "anthropic/claude-haiku-4-5-20251001",
      });

      const page = v3.context.pages()[0];
      await page.goto("https://example.com");

      try {
        await agent.execute({
          instruction: "test",
          callbacks: {
            onChunk: (() => {}) as never,
            onFinish: (() => {}) as never,
          },
        });
        throw new Error("Expected error to be thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(StreamingCallbacksInNonStreamingModeError);
        expect(
          (error as StreamingCallbacksInNonStreamingModeError).invalidCallbacks,
        ).toEqual(["onChunk", "onFinish"]);
      }
    });
  });

  test.describe("Combined callbacks", () => {
    test("multiple callbacks can be used together", async () => {
      test.setTimeout(60000);

      let prepareStepCount = 0;
      let stepFinishCount = 0;

      const agent = v3.agent({
        model: "anthropic/claude-haiku-4-5-20251001",
      });

      const page = v3.context.pages()[0];
      await page.goto("https://example.com");

      await agent.execute({
        instruction: "Use close tool with taskComplete: true immediately.",
        maxSteps: 3,
        callbacks: {
          prepareStep: async (stepContext) => {
            prepareStepCount++;
            return stepContext;
          },
          onStepFinish: async () => {
            stepFinishCount++;
          },
        },
      });

      // Both callbacks should have been called
      expect(prepareStepCount).toBeGreaterThan(0);
      expect(stepFinishCount).toBeGreaterThan(0);
    });

    test("streaming with multiple callbacks", async () => {
      test.setTimeout(60000);

      let prepareStepCount = 0;
      let stepFinishCount = 0;
      let chunkCount = 0;
      let finishCalled = false;

      const agent = v3.agent({
        stream: true,
        model: "anthropic/claude-haiku-4-5-20251001",
      });

      const page = v3.context.pages()[0];
      await page.goto("https://example.com");

      const streamResult = await agent.execute({
        instruction:
          "Say hello briefly and then use close tool with taskComplete: true",
        maxSteps: 3,
        callbacks: {
          prepareStep: async (stepContext) => {
            prepareStepCount++;
            return stepContext;
          },
          onStepFinish: async () => {
            stepFinishCount++;
          },
          onChunk: async () => {
            chunkCount++;
          },
          onFinish: () => {
            finishCalled = true;
          },
        },
      });

      // Consume the stream
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of streamResult.textStream) {
        // Just consume
      }

      await streamResult.result;

      // All callbacks should have been called
      expect(prepareStepCount).toBeGreaterThan(0);
      expect(stepFinishCount).toBeGreaterThan(0);
      expect(chunkCount).toBeGreaterThan(0);
      expect(finishCalled).toBe(true);
    });
  });
});
