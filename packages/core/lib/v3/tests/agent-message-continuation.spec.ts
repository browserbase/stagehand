import { test, expect } from "@playwright/test";
import { V3 } from "../v3";
import { v3TestConfig } from "./v3.config";
import type { ModelMessage } from "ai";

test.describe("Stagehand agent message continuation", () => {
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

  test("execute returns messages in the result", async () => {
    test.setTimeout(60000);

    const agent = v3.agent({
      model: "anthropic/claude-haiku-4-5-20251001",
    });

    const page = v3.context.pages()[0];
    await page.goto("https://example.com");

    const result = await agent.execute({
      instruction:
        "What is the title of this page? Use close tool with taskComplete: true after answering.",
      maxSteps: 5,
    });

    // Result should contain messages
    expect(result.messages).toBeDefined();
    expect(Array.isArray(result.messages)).toBe(true);
    expect(result.messages!.length).toBeGreaterThan(0);

    // First message should be the user instruction
    const firstMessage = result.messages![0];
    expect(firstMessage.role).toBe("user");
  });

  test("can continue conversation with previous messages", async () => {
    test.setTimeout(120000);

    const agent = v3.agent({
      model: "anthropic/claude-haiku-4-5-20251001",
    });

    const page = v3.context.pages()[0];
    await page.goto("https://example.com");

    // First execution
    const result1 = await agent.execute({
      instruction:
        "What is the title of this page? Use close tool with taskComplete: true after answering.",
      maxSteps: 5,
    });

    expect(result1.messages).toBeDefined();
    expect(result1.messages!.length).toBeGreaterThan(0);

    // Second execution continuing from first
    const result2 = await agent.execute({
      instruction:
        "Based on what you just told me, is this a simple or complex website? Use close tool with taskComplete: true after answering.",
      maxSteps: 5,
      messages: result1.messages,
    });

    expect(result2.messages).toBeDefined();
    // Second result should have more messages (includes first conversation)
    expect(result2.messages!.length).toBeGreaterThan(result1.messages!.length);
  });

  test("messages include tool calls and results", async () => {
    test.setTimeout(60000);

    const agent = v3.agent({
      model: "anthropic/claude-haiku-4-5-20251001",
    });

    const page = v3.context.pages()[0];
    await page.goto("https://example.com");

    const result = await agent.execute({
      instruction:
        "Use the ariaTree tool to see the page, then use close tool with taskComplete: true.",
      maxSteps: 5,
    });

    expect(result.messages).toBeDefined();

    // Verify there are assistant messages
    const assistantMessages = result.messages!.filter(
      (m: ModelMessage) => m.role === "assistant",
    );
    expect(assistantMessages.length).toBeGreaterThan(0);

    // Verify at least one assistant message contains tool calls
    const hasToolCalls = assistantMessages.some((m: ModelMessage) => {
      if (Array.isArray(m.content)) {
        return m.content.some(
          (part) => typeof part === "object" && part.type === "tool-call",
        );
      }
      return false;
    });
    expect(hasToolCalls).toBe(true);

    // Verify there are tool result messages
    const hasToolResults = result.messages!.some(
      (m: ModelMessage) => m.role === "tool",
    );
    expect(hasToolResults).toBe(true);
  });

  test("streaming mode also returns messages", async () => {
    test.setTimeout(60000);

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
    });

    // Consume the stream
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ of streamResult.textStream) {
      // Just consume
    }

    const result = await streamResult.result;

    // Result should contain messages
    expect(result.messages).toBeDefined();
    expect(Array.isArray(result.messages)).toBe(true);
    expect(result.messages!.length).toBeGreaterThan(0);
  });
});
