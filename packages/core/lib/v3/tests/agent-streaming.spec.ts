import { test, expect } from "@playwright/test";
import { V3 } from "../v3";
import { v3TestConfig } from "./v3.config";
import type { AgentResult } from "../types/public/agent";

test.describe("Stagehand agent streaming behavior", () => {
  let v3: V3;

  test.beforeEach(async () => {
    v3 = new V3({
      ...v3TestConfig,
      experimental: true, // Required for streaming
    });
    await v3.init();
  });

  test.afterEach(async () => {
    await v3?.close?.().catch(() => {});
  });

  test.describe("agent({ stream: true })", () => {
    test("AgentStreamResult has textStream as async iterable", async () => {
      test.setTimeout(60000);

      const agent = v3.agent({
        stream: true,
        model: "anthropic/claude-haiku-4-5-20251001",
      });

      // Navigate to a simple page first
      const page = v3.context.pages()[0];
      await page.goto("https://example.com");

      const streamResult = await agent.execute({
        instruction:
          "What is the title of this page? Use the close tool immediately after answering.",
        maxSteps: 3,
      });

      // Verify it's an AgentStreamResult with streaming capabilities
      expect(streamResult).toHaveProperty("textStream");
      expect(streamResult).toHaveProperty("result");

      // textStream should be async iterable
      expect(typeof streamResult.textStream[Symbol.asyncIterator]).toBe(
        "function",
      );

      // result should be a promise
      expect(streamResult.result).toBeInstanceOf(Promise);
    });

    test("textStream yields chunks incrementally", async () => {
      test.setTimeout(60000);

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
      });

      // Collect chunks from the stream
      const chunks: string[] = [];
      for await (const chunk of streamResult.textStream) {
        chunks.push(chunk);
      }

      // Should have received at least some chunks (streaming behavior)
      // The exact content depends on the LLM response
      expect(Array.isArray(chunks)).toBe(true);
      expect(chunks.length).toBeGreaterThan(0);
    });

    test("result promise resolves to AgentResult after stream completes", async () => {
      test.setTimeout(60000);

      const agent = v3.agent({
        stream: true,
        model: "anthropic/claude-haiku-4-5-20251001",
      });

      const page = v3.context.pages()[0];
      await page.goto("https://example.com");

      const streamResult = await agent.execute({
        instruction:
          "What is this page about? Use close tool with taskComplete: true after answering.",
        maxSteps: 5,
      });

      // Consume the stream first
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of streamResult.textStream) {
        // Just consume
      }

      // Now get the final result
      const finalResult: AgentResult = await streamResult.result;

      // Verify it's a proper AgentResult
      expect(finalResult).toHaveProperty("success");
      expect(finalResult).toHaveProperty("message");
      expect(finalResult).toHaveProperty("actions");
      expect(finalResult).toHaveProperty("completed");
      expect(typeof finalResult.success).toBe("boolean");
      expect(typeof finalResult.message).toBe("string");
      expect(Array.isArray(finalResult.actions)).toBe(true);
    });
  });

  test.describe("agent({ stream: false }) or agent()", () => {
    test("execute returns AgentResult without streaming properties", async () => {
      test.setTimeout(60000);

      const agent = v3.agent({
        model: "anthropic/claude-haiku-4-5-20251001",
      });

      const page = v3.context.pages()[0];
      await page.goto("https://example.com");

      const result = await agent.execute({
        instruction: "What is this page? Use close tool immediately.",
        maxSteps: 3,
      });

      // Should be AgentResult, not AgentStreamResult
      expect(result).toHaveProperty("success");
      expect(result).toHaveProperty("message");
      expect(result).toHaveProperty("actions");
      expect(result).toHaveProperty("completed");

      // Should NOT have streaming properties
      expect(result).not.toHaveProperty("textStream");
    });
  });

  test.describe("CUA disables streaming", () => {
    test("throws StagehandInvalidArgumentError when cua: true and stream: true", () => {
      expect(() => {
        v3.agent({
          cua: true,
          stream: true,
          model: "anthropic/claude-haiku-4-5-20251001",
        });
      }).toThrow("Streaming is not supported with CUA");
    });

    test("allows cua: true without stream", () => {
      // Should not throw
      const agent = v3.agent({
        cua: true,
        model: "anthropic/claude-haiku-4-5-20251001",
      });

      expect(agent).toHaveProperty("execute");
    });

    test("allows stream: true without cua", () => {
      // Should not throw
      const agent = v3.agent({
        stream: true,
        model: "anthropic/claude-haiku-4-5-20251001",
      });

      expect(agent).toHaveProperty("execute");
    });
  });
});
