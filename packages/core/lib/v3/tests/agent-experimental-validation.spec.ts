import { test, expect } from "@playwright/test";
import { z } from "zod";
import { tool } from "ai";
import { V3 } from "../v3";
import { v3TestConfig } from "./v3.config";
import {
  ExperimentalNotConfiguredError,
  StagehandInvalidArgumentError,
} from "../types/public/sdkErrors";

// Define a mock custom tool for testing
const mockCustomTool = tool({
  description: "A mock tool for testing",
  inputSchema: z.object({
    input: z.string().describe("The input string"),
  }),
  execute: async ({ input }) => {
    return `Processed: ${input}`;
  },
});

test.describe("Stagehand agent experimental feature validation", () => {
  test.describe("Invalid argument errors", () => {
    let v3: V3;

    test.beforeEach(async () => {
      v3 = new V3({
        ...v3TestConfig,
        experimental: false,
      });
      await v3.init();
    });

    test.afterEach(async () => {
      await v3?.close?.().catch(() => {});
    });

    test("throws StagehandInvalidArgumentError when CUA and streaming are both enabled", async () => {
      try {
        v3.agent({
          cua: true,
          stream: true,
          model: "anthropic/claude-sonnet-4-20250514",
        });
        throw new Error("Expected error to be thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(StagehandInvalidArgumentError);
        expect((error as Error).message).toContain("streaming");
        expect((error as Error).message).toContain("not supported with CUA");
      }
    });

    test("throws StagehandInvalidArgumentError for CUA + streaming even with experimental: true", async () => {
      // Close the non-experimental instance
      await v3.close();

      // Create an experimental instance
      const v3Experimental = new V3({
        ...v3TestConfig,
        experimental: true,
      });
      await v3Experimental.init();

      try {
        v3Experimental.agent({
          cua: true,
          stream: true,
          model: "anthropic/claude-sonnet-4-20250514",
        });
        throw new Error("Expected error to be thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(StagehandInvalidArgumentError);
        expect((error as Error).message).toContain("streaming");
        expect((error as Error).message).toContain("not supported with CUA");
      } finally {
        await v3Experimental.close();
      }
    });
  });

  test.describe("Experimental feature errors without experimental: true", () => {
    let v3: V3;

    test.beforeEach(async () => {
      v3 = new V3({
        ...v3TestConfig,
        experimental: false,
      });
      await v3.init();
    });

    test.afterEach(async () => {
      await v3?.close?.().catch(() => {});
    });

    test("throws ExperimentalNotConfiguredError for MCP integrations", async () => {
      const agent = v3.agent({
        model: "anthropic/claude-sonnet-4-20250514",
        integrations: ["https://mcp.example.com"],
      });

      try {
        await agent.execute("test");
        throw new Error("Expected error to be thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ExperimentalNotConfiguredError);
        expect((error as Error).message).toContain(
          "MCP integrations and custom tools",
        );
      }
    });

    test("throws ExperimentalNotConfiguredError for custom tools", async () => {
      const agent = v3.agent({
        model: "anthropic/claude-sonnet-4-20250514",
        tools: {
          mockCustomTool,
        },
      });

      try {
        await agent.execute("test");
        throw new Error("Expected error to be thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ExperimentalNotConfiguredError);
        expect((error as Error).message).toContain(
          "MCP integrations and custom tools",
        );
      }
    });

    test("throws ExperimentalNotConfiguredError for streaming mode", async () => {
      try {
        const agent = v3.agent({
          stream: true,
          model: "anthropic/claude-sonnet-4-20250514",
        });
        await agent.execute("test instruction");
        throw new Error("Expected error to be thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ExperimentalNotConfiguredError);
        expect((error as Error).message).toContain("streaming");
      }
    });

    test("throws ExperimentalNotConfiguredError for callbacks", async () => {
      const agent = v3.agent({
        model: "anthropic/claude-sonnet-4-20250514",
      });

      try {
        await agent.execute({
          instruction: "test",
          callbacks: {
            onStepFinish: async () => {},
          },
        });
        throw new Error("Expected error to be thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ExperimentalNotConfiguredError);
        expect((error as Error).message).toContain("callbacks");
      }
    });

    test("throws ExperimentalNotConfiguredError for abort signal", async () => {
      const agent = v3.agent({
        model: "anthropic/claude-sonnet-4-20250514",
      });

      const controller = new AbortController();
      try {
        await agent.execute({
          instruction: "test",
          signal: controller.signal,
        });
        throw new Error("Expected error to be thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ExperimentalNotConfiguredError);
        expect((error as Error).message).toContain("abort signal");
      }
    });

    test("throws ExperimentalNotConfiguredError for message continuation", async () => {
      const agent = v3.agent({
        model: "anthropic/claude-sonnet-4-20250514",
      });

      try {
        await agent.execute({
          instruction: "test",
          messages: [{ role: "user", content: "previous message" }],
        });
        throw new Error("Expected error to be thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ExperimentalNotConfiguredError);
        expect((error as Error).message).toContain("message continuation");
      }
    });

    test("throws ExperimentalNotConfiguredError listing multiple features", async () => {
      const agent = v3.agent({
        model: "anthropic/claude-sonnet-4-20250514",
      });

      const controller = new AbortController();
      try {
        await agent.execute({
          instruction: "test",
          callbacks: { onStepFinish: async () => {} },
          signal: controller.signal,
          messages: [{ role: "user", content: "previous" }],
        });
        throw new Error("Expected error to be thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ExperimentalNotConfiguredError);
        const message = (error as Error).message;
        expect(message).toContain("callbacks");
        expect(message).toContain("abort signal");
        expect(message).toContain("message continuation");
      }
    });
  });

  test.describe("CUA agent unsupported features", () => {
    let v3: V3;

    test.beforeEach(async () => {
      v3 = new V3({
        ...v3TestConfig,
        experimental: false,
      });
      await v3.init();
    });

    test.afterEach(async () => {
      await v3?.close?.().catch(() => {});
    });

    test("throws ExperimentalNotConfiguredError for CUA with integrations", async () => {
      // MCP integrations are still an experimental feature check (not unsupported)
      try {
        v3.agent({
          cua: true,
          model: "anthropic/claude-sonnet-4-20250514",
          integrations: ["https://mcp.example.com"],
        });
        throw new Error("Expected error to be thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ExperimentalNotConfiguredError);
        expect((error as Error).message).toContain(
          "MCP integrations and custom tools",
        );
      }
    });

    test("throws StagehandInvalidArgumentError for CUA with abort signal (not supported)", async () => {
      const agent = v3.agent({
        cua: true,
        model: "anthropic/claude-sonnet-4-20250514",
      });

      const controller = new AbortController();
      try {
        await agent.execute({
          instruction: "test",
          signal: controller.signal,
        });
        throw new Error("Expected error to be thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(StagehandInvalidArgumentError);
        expect((error as Error).message).toContain("abort signal");
        expect((error as Error).message).toContain("not supported with CUA");
      }
    });

    test("throws StagehandInvalidArgumentError for CUA with message continuation (not supported)", async () => {
      const agent = v3.agent({
        cua: true,
        model: "anthropic/claude-sonnet-4-20250514",
      });

      try {
        await agent.execute({
          instruction: "test",
          messages: [{ role: "user", content: "previous message" }],
        });
        throw new Error("Expected error to be thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(StagehandInvalidArgumentError);
        expect((error as Error).message).toContain("message continuation");
        expect((error as Error).message).toContain("not supported with CUA");
      }
    });

    test("throws StagehandInvalidArgumentError for CUA with multiple unsupported features", async () => {
      const agent = v3.agent({
        cua: true,
        model: "anthropic/claude-sonnet-4-20250514",
      });

      const controller = new AbortController();
      try {
        await agent.execute({
          instruction: "test",
          signal: controller.signal,
          messages: [{ role: "user", content: "previous message" }],
        });
        throw new Error("Expected error to be thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(StagehandInvalidArgumentError);
        const message = (error as Error).message;
        expect(message).toContain("abort signal");
        expect(message).toContain("message continuation");
        expect(message).toContain("are not supported with CUA");
      }
    });

    test("throws StagehandInvalidArgumentError for CUA unsupported features even with experimental: true", async () => {
      // Close the non-experimental instance
      await v3.close();

      // Create an experimental instance
      const v3Experimental = new V3({
        ...v3TestConfig,
        experimental: true,
      });
      await v3Experimental.init();

      const agent = v3Experimental.agent({
        cua: true,
        model: "anthropic/claude-sonnet-4-20250514",
      });

      const controller = new AbortController();
      try {
        await agent.execute({
          instruction: "test",
          signal: controller.signal,
        });
        throw new Error("Expected error to be thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(StagehandInvalidArgumentError);
        expect((error as Error).message).toContain("not supported with CUA");
      } finally {
        await v3Experimental.close();
      }
    });
  });

  test.describe("Valid configurations with experimental: true", () => {
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

    test("allows CUA without streaming", () => {
      expect(() =>
        v3.agent({
          cua: true,
          model: "anthropic/claude-sonnet-4-20250514",
        }),
      ).not.toThrow();
    });

    test("allows streaming mode", () => {
      expect(() =>
        v3.agent({
          stream: true,
          model: "anthropic/claude-sonnet-4-20250514",
        }),
      ).not.toThrow();
    });

    test("allows basic agent without experimental features", async () => {
      const v3NonExperimental = new V3({
        ...v3TestConfig,
        experimental: false,
      });
      await v3NonExperimental.init();

      try {
        // This should work - just creating a basic agent with no experimental features
        expect(() =>
          v3NonExperimental.agent({
            model: "anthropic/claude-sonnet-4-20250514",
          }),
        ).not.toThrow();
      } finally {
        await v3NonExperimental.close();
      }
    });
  });
});
