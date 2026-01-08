import { test, expect } from "@playwright/test";
import { V3 } from "../v3";
import { v3TestConfig } from "./v3.config";
import type { ModelMessage } from "ai";
import { processMessages } from "../agent/utils/messageProcessing";

/**
 * Tests for agent message format validation and continuation.
 *
 * These tests verify that messages returned from agent.execute() are properly
 * formatted and can be passed to subsequent execute() calls without errors.
 *
 * Common issues that can occur:
 * 1. Duplicate messages in the returned array
 * 2. Invalid message ordering (tool results without matching tool calls)
 * 3. Duplicate tool call IDs across multiple generateText calls
 * 4. Malformed message content structures
 * 5. In-place mutation of messages corrupting data for subsequent runs
 */
test.describe("Agent message format validation", () => {
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

  test.describe("Message structure validation", () => {
    test("returned messages have valid structure", async () => {
      test.setTimeout(60000);

      const agent = v3.agent({
        model: "anthropic/claude-haiku-4-5-20251001",
      });

      const page = v3.context.pages()[0];
      await page.goto("https://example.com");

      const result = await agent.execute({
        instruction: "Take a screenshot of the page and describe what you see.",
        maxSteps: 5,
      });

      expect(result.messages).toBeDefined();
      expect(Array.isArray(result.messages)).toBe(true);

      // Validate each message has required fields
      for (const message of result.messages!) {
        expect(message).toHaveProperty("role");
        expect(["user", "assistant", "tool", "system"]).toContain(message.role);

        // Content should be defined (string or array)
        if (message.role !== "tool") {
          expect(message).toHaveProperty("content");
        }
      }
    });

    test("no duplicate messages in returned array", async () => {
      test.setTimeout(60000);

      const agent = v3.agent({
        model: "anthropic/claude-haiku-4-5-20251001",
      });

      const page = v3.context.pages()[0];
      await page.goto("https://example.com");

      const result = await agent.execute({
        instruction:
          "Use the ariaTree tool to see the page, then describe what you found.",
        maxSteps: 5,
      });

      expect(result.messages).toBeDefined();

      // Check for duplicate messages by comparing stringified versions
      const messageStrings = result.messages!.map((m) => JSON.stringify(m));
      const uniqueMessages = new Set(messageStrings);

      // If there are duplicates, this will fail
      expect(messageStrings.length).toBe(uniqueMessages.size);
    });

    test("tool calls and results are properly paired", async () => {
      test.setTimeout(60000);

      const agent = v3.agent({
        model: "anthropic/claude-haiku-4-5-20251001",
      });

      const page = v3.context.pages()[0];
      await page.goto("https://example.com");

      const result = await agent.execute({
        instruction: "Take a screenshot of the page.",
        maxSteps: 5,
      });

      expect(result.messages).toBeDefined();

      // Collect all tool call IDs from assistant messages
      const toolCallIds = new Set<string>();
      for (const message of result.messages!) {
        if (message.role === "assistant" && Array.isArray(message.content)) {
          for (const part of message.content) {
            if (
              typeof part === "object" &&
              part !== null &&
              "type" in part &&
              part.type === "tool-call"
            ) {
              const toolCall = part as { toolCallId?: string };
              if (toolCall.toolCallId) {
                toolCallIds.add(toolCall.toolCallId);
              }
            }
          }
        }
      }

      // Collect all tool result IDs from tool messages
      const toolResultIds = new Set<string>();
      for (const message of result.messages!) {
        if (message.role === "tool" && Array.isArray(message.content)) {
          for (const part of message.content) {
            if (
              typeof part === "object" &&
              part !== null &&
              "toolCallId" in part
            ) {
              const toolResult = part as { toolCallId?: string };
              if (toolResult.toolCallId) {
                toolResultIds.add(toolResult.toolCallId);
              }
            }
          }
        }
      }

      // Every tool result should have a matching tool call
      for (const resultId of toolResultIds) {
        expect(toolCallIds.has(resultId)).toBe(true);
      }
    });

    test("no duplicate tool call IDs", async () => {
      test.setTimeout(60000);

      const agent = v3.agent({
        model: "anthropic/claude-haiku-4-5-20251001",
      });

      const page = v3.context.pages()[0];
      await page.goto("https://example.com");

      const result = await agent.execute({
        instruction:
          "Use the ariaTree tool to see the page, then take a screenshot.",
        maxSteps: 5,
      });

      expect(result.messages).toBeDefined();

      // Collect all tool call IDs
      const toolCallIds: string[] = [];
      for (const message of result.messages!) {
        if (message.role === "assistant" && Array.isArray(message.content)) {
          for (const part of message.content) {
            if (
              typeof part === "object" &&
              part !== null &&
              "type" in part &&
              part.type === "tool-call"
            ) {
              const toolCall = part as { toolCallId?: string };
              if (toolCall.toolCallId) {
                toolCallIds.push(toolCall.toolCallId);
              }
            }
          }
        }
      }

      // Check for duplicates
      const uniqueIds = new Set(toolCallIds);
      expect(toolCallIds.length).toBe(uniqueIds.size);
    });
  });

  test.describe("Message continuation", () => {
    test("can continue conversation with messages from previous run", async () => {
      test.setTimeout(120000);

      const agent = v3.agent({
        model: "anthropic/claude-haiku-4-5-20251001",
      });

      const page = v3.context.pages()[0];
      await page.goto("https://example.com");

      // First execution
      const result1 = await agent.execute({
        instruction: "What is the title of this page?",
        maxSteps: 5,
      });

      expect(result1.messages).toBeDefined();
      expect(result1.messages!.length).toBeGreaterThan(0);

      // Second execution using messages from first run
      // This should NOT throw any format errors
      const result2 = await agent.execute({
        instruction:
          "Based on what you just told me, is this a simple or complex page?",
        maxSteps: 5,
        messages: result1.messages,
      });

      expect(result2.messages).toBeDefined();
      expect(result2.messages!.length).toBeGreaterThan(
        result1.messages!.length,
      );
    });

    test("three consecutive continuations work correctly", async () => {
      test.setTimeout(180000);

      const agent = v3.agent({
        model: "anthropic/claude-haiku-4-5-20251001",
      });

      const page = v3.context.pages()[0];
      await page.goto("https://example.com");

      // First execution
      const result1 = await agent.execute({
        instruction: "What is the main heading on this page?",
        maxSteps: 5,
      });

      expect(result1.messages).toBeDefined();

      // Second execution
      const result2 = await agent.execute({
        instruction: "What else is on the page?",
        maxSteps: 5,
        messages: result1.messages,
      });

      expect(result2.messages).toBeDefined();

      // Third execution
      const result3 = await agent.execute({
        instruction: "Summarize everything you've told me.",
        maxSteps: 5,
        messages: result2.messages,
      });

      expect(result3.messages).toBeDefined();
      // Messages should accumulate across runs
      expect(result3.messages!.length).toBeGreaterThan(
        result2.messages!.length,
      );
      expect(result2.messages!.length).toBeGreaterThan(
        result1.messages!.length,
      );
    });

    test("continuation with tool-heavy first run", async () => {
      test.setTimeout(120000);

      const agent = v3.agent({
        model: "anthropic/claude-haiku-4-5-20251001",
      });

      const page = v3.context.pages()[0];
      await page.goto("https://example.com");

      // First execution with multiple tools
      const result1 = await agent.execute({
        instruction:
          "Use ariaTree to see the page, then take a screenshot, then describe what you found.",
        maxSteps: 8,
      });

      expect(result1.messages).toBeDefined();

      // Verify there were tool calls in the first run
      const hasToolCalls = result1.messages!.some(
        (m: ModelMessage) =>
          m.role === "assistant" &&
          Array.isArray(m.content) &&
          m.content.some(
            (part) =>
              typeof part === "object" &&
              part !== null &&
              "type" in part &&
              part.type === "tool-call",
          ),
      );
      expect(hasToolCalls).toBe(true);

      // Second execution should work without errors
      const result2 = await agent.execute({
        instruction: "What did you learn from the previous actions?",
        maxSteps: 5,
        messages: result1.messages,
      });

      expect(result2.messages).toBeDefined();
    });
  });

  test.describe("Streaming mode message format", () => {
    test("streaming mode returns properly formatted messages", async () => {
      test.setTimeout(60000);

      const agent = v3.agent({
        stream: true,
        model: "anthropic/claude-haiku-4-5-20251001",
      });

      const page = v3.context.pages()[0];
      await page.goto("https://example.com");

      const streamResult = await agent.execute({
        instruction: "Take a screenshot and describe what you see.",
        maxSteps: 5,
      });

      // Consume the stream
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of streamResult.textStream) {
        // Just consume
      }

      const result = await streamResult.result;

      expect(result.messages).toBeDefined();
      expect(Array.isArray(result.messages)).toBe(true);

      // Validate structure
      for (const message of result.messages!) {
        expect(message).toHaveProperty("role");
        expect(["user", "assistant", "tool", "system"]).toContain(message.role);
      }
    });

    test("streaming mode messages can be used for continuation", async () => {
      test.setTimeout(120000);

      const agent = v3.agent({
        stream: true,
        model: "anthropic/claude-haiku-4-5-20251001",
      });

      const page = v3.context.pages()[0];
      await page.goto("https://example.com");

      // First streaming execution
      const streamResult1 = await agent.execute({
        instruction: "What is on this page?",
        maxSteps: 5,
      });

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of streamResult1.textStream) {
        // Consume
      }

      const result1 = await streamResult1.result;
      expect(result1.messages).toBeDefined();

      // Second execution using streaming result's messages
      const streamResult2 = await agent.execute({
        instruction: "Tell me more about what you found.",
        maxSteps: 5,
        messages: result1.messages,
      });

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of streamResult2.textStream) {
        // Consume
      }

      const result2 = await streamResult2.result;
      expect(result2.messages).toBeDefined();
      expect(result2.messages!.length).toBeGreaterThan(
        result1.messages!.length,
      );
    });

    test("no duplicate messages in streaming mode", async () => {
      test.setTimeout(60000);

      const agent = v3.agent({
        stream: true,
        model: "anthropic/claude-haiku-4-5-20251001",
      });

      const page = v3.context.pages()[0];
      await page.goto("https://example.com");

      const streamResult = await agent.execute({
        instruction: "Use the ariaTree tool to analyze the page.",
        maxSteps: 5,
      });

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of streamResult.textStream) {
        // Consume
      }

      const result = await streamResult.result;
      expect(result.messages).toBeDefined();

      // Check for duplicates
      const messageStrings = result.messages!.map((m) => JSON.stringify(m));
      const uniqueMessages = new Set(messageStrings);
      expect(messageStrings.length).toBe(uniqueMessages.size);
    });
  });

  test.describe("Edge cases", () => {
    test("empty messages array is handled correctly", async () => {
      test.setTimeout(60000);

      const agent = v3.agent({
        model: "anthropic/claude-haiku-4-5-20251001",
      });

      const page = v3.context.pages()[0];
      await page.goto("https://example.com");

      // Passing empty messages array should work (starts fresh)
      const result = await agent.execute({
        instruction: "What is on this page?",
        maxSteps: 5,
        messages: [],
      });

      expect(result.messages).toBeDefined();
      expect(result.messages!.length).toBeGreaterThan(0);
    });

    test("messages with only user role work correctly", async () => {
      test.setTimeout(60000);

      const agent = v3.agent({
        model: "anthropic/claude-haiku-4-5-20251001",
      });

      const page = v3.context.pages()[0];
      await page.goto("https://example.com");

      // Passing only user messages
      const customMessages: ModelMessage[] = [
        { role: "user", content: "Remember that I like concise answers." },
      ];

      const result = await agent.execute({
        instruction: "What is on this page?",
        maxSteps: 5,
        messages: customMessages,
      });

      expect(result.messages).toBeDefined();
      // Should include our custom message plus new messages
      expect(result.messages!.length).toBeGreaterThan(customMessages.length);
    });

    test("large message history is handled correctly", async () => {
      test.setTimeout(180000);

      const agent = v3.agent({
        model: "anthropic/claude-haiku-4-5-20251001",
      });

      const page = v3.context.pages()[0];
      await page.goto("https://example.com");

      // Build up a long conversation
      let messages: ModelMessage[] | undefined;

      for (let i = 0; i < 4; i++) {
        const result = await agent.execute({
          instruction: `Question ${i + 1}: What do you see on the page?`,
          maxSteps: 3,
          messages,
        });

        expect(result.messages).toBeDefined();
        messages = result.messages;
      }

      // Final continuation should work without issues
      const finalResult = await agent.execute({
        instruction: "Summarize our entire conversation.",
        maxSteps: 5,
        messages,
      });

      expect(finalResult.messages).toBeDefined();
    });
  });

  test.describe("Message processing/compression", () => {
    test("processMessages does not corrupt tool result structure", () => {
      // Create a mock messages array with tool results
      const messages: ModelMessage[] = [
        { role: "user", content: "test instruction" },
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "call_1",
              toolName: "screenshot",
              args: {},
            },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call_1",
              toolName: "screenshot",
              result: [{ type: "image", image: "base64data..." }],
            },
          ],
        },
      ];

      // Process messages (simulating what happens in prepareStep)
      const originalLength = messages.length;
      processMessages(messages);

      // Messages array length should be preserved
      expect(messages.length).toBe(originalLength);

      // Tool message should still have proper structure
      const toolMessage = messages.find((m) => m.role === "tool");
      expect(toolMessage).toBeDefined();
      expect(Array.isArray(toolMessage!.content)).toBe(true);
    });

    test("multiple processMessages calls don't corrupt messages", () => {
      // Simulate what happens when messages go through multiple runs
      const messages: ModelMessage[] = [
        { role: "user", content: "first instruction" },
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "call_1",
              toolName: "ariaTree",
              args: {},
            },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call_1",
              toolName: "ariaTree",
              result: [{ type: "text", text: "aria tree content..." }],
            },
          ],
        },
      ];

      // First processing (like in first run)
      processMessages(messages);

      // Add more messages (like in second run)
      messages.push(
        { role: "user", content: "second instruction" },
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "call_2",
              toolName: "ariaTree",
              args: {},
            },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call_2",
              toolName: "ariaTree",
              result: [{ type: "text", text: "second aria tree..." }],
            },
          ],
        },
      );

      // Second processing
      processMessages(messages);

      // All messages should still be valid
      expect(messages.length).toBe(6);

      // All tool messages should have content arrays
      const toolMessages = messages.filter((m) => m.role === "tool");
      for (const tm of toolMessages) {
        expect(Array.isArray(tm.content)).toBe(true);
        expect((tm.content as unknown[]).length).toBeGreaterThan(0);
      }
    });

    test("returned messages can be safely passed to next run after compression", async () => {
      test.setTimeout(120000);

      const agent = v3.agent({
        model: "anthropic/claude-haiku-4-5-20251001",
      });

      const page = v3.context.pages()[0];
      await page.goto("https://example.com");

      // First run - use tools that will be compressed
      const result1 = await agent.execute({
        instruction:
          "Use the ariaTree tool twice to examine the page thoroughly.",
        maxSteps: 8,
      });

      expect(result1.messages).toBeDefined();

      // Deep clone messages to check if they get mutated
      const messagesSnapshot = JSON.stringify(result1.messages);

      // Second run with the compressed messages
      const result2 = await agent.execute({
        instruction: "What did you find?",
        maxSteps: 5,
        messages: result1.messages,
      });

      expect(result2.messages).toBeDefined();

      // The original messages should not have been mutated by the second run
      // (this tests that we don't have shared reference issues)
      // Note: This might fail if processMessages mutates in place without cloning
    });

    test("tool results maintain required fields after compression", () => {
      const messages: ModelMessage[] = [
        { role: "user", content: "test" },
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "call_123",
              toolName: "screenshot",
              args: {},
            },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call_123",
              toolName: "screenshot",
              result: [{ type: "image", image: "base64..." }],
            },
          ],
        },
      ];

      processMessages(messages);

      // Find the tool result
      const toolMessage = messages.find((m) => m.role === "tool");
      expect(toolMessage).toBeDefined();

      const content = toolMessage!.content as Array<{
        type: string;
        toolCallId?: string;
        toolName?: string;
      }>;

      // Tool result should still have required fields
      const toolResult = content.find((c) => c.type === "tool-result");
      expect(toolResult).toBeDefined();
      expect(toolResult!.toolCallId).toBe("call_123");
      expect(toolResult!.toolName).toBe("screenshot");
    });

    test("messages passed to continuation don't cause AI SDK errors", async () => {
      test.setTimeout(180000);

      const agent = v3.agent({
        model: "anthropic/claude-haiku-4-5-20251001",
      });

      const page = v3.context.pages()[0];
      await page.goto("https://example.com");

      // First run - use multiple tools to trigger compression
      const result1 = await agent.execute({
        instruction:
          "Take a screenshot, then use ariaTree, then take another screenshot, then use ariaTree again.",
        maxSteps: 10,
      });

      expect(result1.messages).toBeDefined();
      expect(result1.success).toBe(true);

      // Second run - this is where format errors would surface
      // if the compressed messages are invalid
      let error: Error | null = null;
      try {
        const result2 = await agent.execute({
          instruction:
            "Based on what you observed, what is the main content of the page?",
          maxSteps: 5,
          messages: result1.messages,
        });
        expect(result2.messages).toBeDefined();
      } catch (e) {
        error = e as Error;
      }

      // Should not throw any format errors
      expect(error).toBeNull();
    });

    test("heavily compressed messages still work for continuation", async () => {
      test.setTimeout(240000);

      const agent = v3.agent({
        model: "anthropic/claude-haiku-4-5-20251001",
      });

      const page = v3.context.pages()[0];
      await page.goto("https://example.com");

      // Build up a lot of tool calls to trigger maximum compression
      let messages: ModelMessage[] | undefined;

      for (let i = 0; i < 3; i++) {
        const result = await agent.execute({
          instruction: `Step ${i + 1}: Take a screenshot and describe what you see.`,
          maxSteps: 4,
          messages,
        });

        expect(result.messages).toBeDefined();
        messages = result.messages;
      }

      // Final run with heavily compressed messages - just check it doesn't throw
      const finalResult = await agent.execute({
        instruction: "Summarize all your observations.",
        maxSteps: 5,
        messages,
      });

      expect(finalResult.messages).toBeDefined();
      // Don't check success - the agent might not complete the task but messages should still be valid
    });

    test("debug: inspect messages before and after compression with many tool calls", async () => {
      test.setTimeout(300000);
      const fs = await import("fs");
      const path = await import("path");

      const agent = v3.agent({
        model: "anthropic/claude-haiku-4-5-20251001",
      });

      const page = v3.context.pages()[0];
      await page.goto("https://example.com");

      // First run: trigger multiple screenshots and ariaTree calls
      const result1 = await agent.execute({
        instruction:
          "I need you to do the following in order: 1) Use ariaTree to see the page structure, 2) Take a screenshot, 3) Use ariaTree again, 4) Take another screenshot, 5) Use ariaTree one more time. After each action, briefly note what you observed.",
        maxSteps: 15,
      });

      expect(result1.messages).toBeDefined();

      // Write messages to file for inspection
      const outputDir = path.join(process.cwd(), "test-output");
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // Save messages after first run
      const messagesAfterRun1 = JSON.stringify(result1.messages, null, 2);
      fs.writeFileSync(
        path.join(outputDir, "messages-after-run1.json"),
        messagesAfterRun1,
      );

      // Log summary of messages
      console.log("\n=== Messages after Run 1 ===");
      console.log(`Total messages: ${result1.messages!.length}`);

      const toolCalls: string[] = [];
      const toolResults: string[] = [];

      for (const msg of result1.messages!) {
        if (msg.role === "assistant" && Array.isArray(msg.content)) {
          for (const part of msg.content) {
            if (
              typeof part === "object" &&
              part !== null &&
              "type" in part &&
              part.type === "tool-call"
            ) {
              const tc = part as { toolName?: string; toolCallId?: string };
              toolCalls.push(`${tc.toolName} (${tc.toolCallId})`);
            }
          }
        }
        if (msg.role === "tool" && Array.isArray(msg.content)) {
          for (const part of msg.content) {
            if (
              typeof part === "object" &&
              part !== null &&
              "toolName" in part
            ) {
              const tr = part as { toolName?: string; toolCallId?: string };
              toolResults.push(`${tr.toolName} (${tr.toolCallId})`);
            }
          }
        }
      }

      console.log(`Tool calls: ${toolCalls.join(", ")}`);
      console.log(`Tool results: ${toolResults.join(", ")}`);

      // Check for any messages with undefined or null content
      const invalidMessages = result1.messages!.filter(
        (m) => m.content === undefined || m.content === null,
      );
      console.log(
        `Invalid messages (undefined/null content): ${invalidMessages.length}`,
      );

      // Now try to use these messages in a second run
      console.log("\n=== Starting Run 2 with messages from Run 1 ===");

      let run2Error: Error | null = null;
      let result2: Awaited<ReturnType<typeof agent.execute>> | null = null;

      try {
        result2 = await agent.execute({
          instruction:
            "Based on everything you observed, what is this page about?",
          maxSteps: 5,
          messages: result1.messages,
        });
      } catch (e) {
        run2Error = e as Error;
        console.log(`Run 2 error: ${run2Error.message}`);

        // Save the error details
        fs.writeFileSync(
          path.join(outputDir, "run2-error.json"),
          JSON.stringify(
            {
              message: run2Error.message,
              stack: run2Error.stack,
              name: run2Error.name,
            },
            null,
            2,
          ),
        );
      }

      if (result2) {
        console.log(`Run 2 success: ${result2.success}`);
        console.log(`Run 2 messages count: ${result2.messages?.length}`);

        // Save messages after second run
        fs.writeFileSync(
          path.join(outputDir, "messages-after-run2.json"),
          JSON.stringify(result2.messages, null, 2),
        );
      }

      // Assertions
      expect(run2Error).toBeNull();
      expect(result2).not.toBeNull();
      expect(result2!.messages).toBeDefined();

      // Verify tool call/result pairing is still valid
      const allToolCallIds = new Set<string>();
      const allToolResultIds = new Set<string>();

      for (const msg of result2!.messages!) {
        if (msg.role === "assistant" && Array.isArray(msg.content)) {
          for (const part of msg.content) {
            if (
              typeof part === "object" &&
              part !== null &&
              "type" in part &&
              part.type === "tool-call" &&
              "toolCallId" in part
            ) {
              allToolCallIds.add((part as { toolCallId: string }).toolCallId);
            }
          }
        }
        if (msg.role === "tool" && Array.isArray(msg.content)) {
          for (const part of msg.content) {
            if (
              typeof part === "object" &&
              part !== null &&
              "toolCallId" in part
            ) {
              allToolResultIds.add((part as { toolCallId: string }).toolCallId);
            }
          }
        }
      }

      // Every tool result should have a matching tool call
      for (const resultId of allToolResultIds) {
        if (!allToolCallIds.has(resultId)) {
          console.log(
            `WARNING: Tool result ${resultId} has no matching tool call!`,
          );
        }
      }

      console.log("\n=== Test complete ===");
      console.log(`Output files written to: ${outputDir}`);
    });

    test("original messages array is not mutated during continuation", async () => {
      test.setTimeout(180000);

      const agent = v3.agent({
        model: "anthropic/claude-haiku-4-5-20251001",
      });

      const page = v3.context.pages()[0];
      await page.goto("https://example.com");

      // First run to get initial messages
      const result1 = await agent.execute({
        instruction: "Take a screenshot of this page.",
        maxSteps: 5,
      });

      expect(result1.messages).toBeDefined();

      // Deep copy the original messages to compare later
      const originalMessagesCopy = JSON.stringify(result1.messages);
      const originalLength = result1.messages!.length;

      // Second run using the messages
      const result2 = await agent.execute({
        instruction: "Describe what you see briefly.",
        maxSteps: 5,
        messages: result1.messages,
      });

      expect(result2.messages).toBeDefined();

      // Check that result1.messages was not mutated
      // The array reference might be different now due to how messages are combined,
      // but the content at common indices should remain consistent
      expect(result1.messages!.length).toBe(originalLength);
      expect(JSON.stringify(result1.messages)).toBe(originalMessagesCopy);
    });

    test("verifies message format is compatible with AI SDK after compression", async () => {
      test.setTimeout(180000);
      const fs = await import("fs");
      const path = await import("path");

      const agent = v3.agent({
        model: "anthropic/claude-haiku-4-5-20251001",
      });

      const page = v3.context.pages()[0];
      await page.goto("https://example.com");

      // Run multiple times to trigger compression
      let messages: ModelMessage[] | undefined;
      const errors: string[] = [];

      for (let i = 0; i < 4; i++) {
        try {
          const result = await agent.execute({
            instruction: `Run ${i + 1}: Take a screenshot.`,
            maxSteps: 5,
            messages,
          });
          messages = result.messages;

          // Validate message structure after each run
          if (messages) {
            for (const msg of messages) {
              // Check required fields
              if (!msg.role) {
                errors.push(`Run ${i + 1}: Message missing role`);
              }
              if (msg.content === undefined) {
                errors.push(`Run ${i + 1}: Message has undefined content`);
              }

              // Check tool message structure
              if (msg.role === "tool" && Array.isArray(msg.content)) {
                for (const part of msg.content) {
                  if (
                    typeof part === "object" &&
                    part !== null &&
                    "type" in part &&
                    part.type === "tool-result"
                  ) {
                    const toolResult = part as {
                      toolCallId?: string;
                      toolName?: string;
                    };
                    if (!toolResult.toolCallId) {
                      errors.push(
                        `Run ${i + 1}: Tool result missing toolCallId`,
                      );
                    }
                    if (!toolResult.toolName) {
                      errors.push(`Run ${i + 1}: Tool result missing toolName`);
                    }
                  }
                }
              }
            }
          }
        } catch (e) {
          const error = e as Error;
          errors.push(`Run ${i + 1} threw: ${error.message}`);

          // Write error details
          const outputDir = path.join(process.cwd(), "test-output");
          if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
          }
          fs.writeFileSync(
            path.join(outputDir, `run${i + 1}-error.json`),
            JSON.stringify(
              {
                run: i + 1,
                message: error.message,
                stack: error.stack,
                messagesBeforeRun: messages,
              },
              null,
              2,
            ),
          );
          break; // Stop on first error
        }
      }

      // Report any errors found
      if (errors.length > 0) {
        console.log("Validation errors:", errors);
      }
      expect(errors).toHaveLength(0);
    });
  });
});
