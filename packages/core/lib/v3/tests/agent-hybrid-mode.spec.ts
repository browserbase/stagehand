import { test, expect } from "@playwright/test";
import { V3 } from "../v3";
import { v3TestConfig } from "./v3.config";
import { createAgentTools } from "../agent/tools";
import { buildAgentSystemPrompt } from "../agent/prompts/agentSystemPrompt";
import type { StepResult, ToolSet } from "ai";

test.describe("Stagehand agent hybrid mode", () => {
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

  test.describe("Tool filtering by mode", () => {
    test("DOM mode includes DOM-based tools and excludes coordinate-based tools", () => {
      const tools = createAgentTools(v3, { mode: "dom" });

      // DOM mode should have these tools
      expect(tools).toHaveProperty("act");
      expect(tools).toHaveProperty("fillForm");
      expect(tools).toHaveProperty("ariaTree");
      expect(tools).toHaveProperty("screenshot");
      expect(tools).toHaveProperty("extract");
      expect(tools).toHaveProperty("goto");
      expect(tools).toHaveProperty("scroll");
      expect(tools).toHaveProperty("wait");
      expect(tools).toHaveProperty("navback");
      expect(tools).toHaveProperty("keys");
      expect(tools).toHaveProperty("think");

      // DOM mode should NOT have coordinate-based tools
      expect(tools).not.toHaveProperty("click");
      expect(tools).not.toHaveProperty("type");
      expect(tools).not.toHaveProperty("dragAndDrop");
      expect(tools).not.toHaveProperty("clickAndHold");
      expect(tools).not.toHaveProperty("fillFormVision");
    });

    test("Hybrid mode includes coordinate-based tools and excludes DOM fillForm", () => {
      const tools = createAgentTools(v3, { mode: "hybrid" });

      // Hybrid mode should have coordinate-based tools
      expect(tools).toHaveProperty("click");
      expect(tools).toHaveProperty("type");
      expect(tools).toHaveProperty("dragAndDrop");
      expect(tools).toHaveProperty("clickAndHold");
      expect(tools).toHaveProperty("fillFormVision");

      // Hybrid mode should also have common tools
      expect(tools).toHaveProperty("act");
      expect(tools).toHaveProperty("ariaTree");
      expect(tools).toHaveProperty("screenshot");
      expect(tools).toHaveProperty("extract");
      expect(tools).toHaveProperty("goto");
      expect(tools).toHaveProperty("scroll");
      expect(tools).toHaveProperty("wait");
      expect(tools).toHaveProperty("navback");
      expect(tools).toHaveProperty("keys");
      expect(tools).toHaveProperty("think");

      // Hybrid mode should NOT have DOM-based fillForm
      expect(tools).not.toHaveProperty("fillForm");
    });

    test("Default mode is DOM when not specified", () => {
      const tools = createAgentTools(v3, {});

      // Should behave like DOM mode
      expect(tools).toHaveProperty("fillForm");
      expect(tools).not.toHaveProperty("click");
      expect(tools).not.toHaveProperty("type");
    });
  });

  test.describe("System prompt generation", () => {
    test("DOM mode system prompt emphasizes ariaTree and act tool", () => {
      const prompt = buildAgentSystemPrompt({
        url: "https://example.com",
        executionInstruction: "Test instruction",
        mode: "dom",
      });

      // DOM mode should prioritize ariaTree
      expect(prompt).toContain("ariaTree");
      expect(prompt).toContain("act");
      expect(prompt).toContain("fillForm");

      // Should have DOM-specific strategy
      expect(prompt).toContain("Use act tool for all clicking and typing");
      expect(prompt).toContain("Always check ariaTree first");
    });

    test("Hybrid mode system prompt emphasizes screenshot and coordinate tools", () => {
      const prompt = buildAgentSystemPrompt({
        url: "https://example.com",
        executionInstruction: "Test instruction",
        mode: "hybrid",
      });

      // Hybrid mode should have coordinate-based tools mentioned
      expect(prompt).toContain("click");
      expect(prompt).toContain("type");
      expect(prompt).toContain("fillFormVision");
      expect(prompt).toContain("dragAndDrop");

      // Should have hybrid-specific strategy
      expect(prompt).toContain(
        "Use specific tools (click, type) when elements are visible",
      );
      expect(prompt).toContain("Always use screenshot");
    });

    test("System prompt includes custom instructions when provided", () => {
      const customInstructions = "Always be polite and thorough";
      const prompt = buildAgentSystemPrompt({
        url: "https://example.com",
        executionInstruction: "Test instruction",
        mode: "dom",
        systemInstructions: customInstructions,
      });

      expect(prompt).toContain("customInstructions");
      expect(prompt).toContain(customInstructions);
    });

    test("System prompt includes Browserbase captcha message when isBrowserbase is true", () => {
      const prompt = buildAgentSystemPrompt({
        url: "https://example.com",
        executionInstruction: "Test instruction",
        mode: "dom",
        isBrowserbase: true,
      });

      expect(prompt).toContain("captcha");
      expect(prompt).toContain("automatically be solved");
    });

    test("System prompt does not include captcha message when isBrowserbase is false", () => {
      const prompt = buildAgentSystemPrompt({
        url: "https://example.com",
        executionInstruction: "Test instruction",
        mode: "dom",
        isBrowserbase: false,
      });

      expect(prompt).not.toContain("automatically be solved");
    });
  });

  test.describe("Agent creation with mode", () => {
    test("agent({ mode: 'dom' }) creates DOM-mode agent", () => {
      const agent = v3.agent({
        mode: "dom",
        model: "anthropic/claude-haiku-4-5-20251001",
      });

      expect(agent).toHaveProperty("execute");
    });

    test("agent({ mode: 'hybrid' }) creates hybrid-mode agent", () => {
      const agent = v3.agent({
        mode: "hybrid",
        model: "anthropic/claude-haiku-4-5-20251001",
      });

      expect(agent).toHaveProperty("execute");
    });

    test("agent without mode defaults to DOM mode", () => {
      const agent = v3.agent({
        model: "anthropic/claude-haiku-4-5-20251001",
      });

      expect(agent).toHaveProperty("execute");
    });

    test("hybrid mode can be combined with streaming", () => {
      const agent = v3.agent({
        mode: "hybrid",
        stream: true,
        model: "anthropic/claude-haiku-4-5-20251001",
      });

      expect(agent).toHaveProperty("execute");
    });
  });

  test.describe("Hybrid mode execution", () => {
    test("hybrid mode agent uses coordinate-based tools when available", async () => {
      test.setTimeout(90000);

      const toolCalls: Array<{ toolName: string; input: unknown }> = [];

      const agent = v3.agent({
        mode: "hybrid",
        model: "anthropic/claude-haiku-4-5-20251001",
      });

      const page = v3.context.pages()[0];
      await page.goto("https://example.com");

      await agent.execute({
        instruction:
          "Take a screenshot to see the page, then describe what you see briefly and mark the task as complete.",
        maxSteps: 5,
        callbacks: {
          onStepFinish: async (event: StepResult<ToolSet>) => {
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

      // Should have captured tool calls
      expect(toolCalls.length).toBeGreaterThan(0);

      const toolNames = toolCalls.map((tc) => tc.toolName);
      // Should include screenshot (hybrid mode emphasizes visual)
      expect(toolNames).toContain("screenshot");
    });

    test("DOM mode agent uses DOM-based tools", async () => {
      test.setTimeout(90000);

      const toolCalls: Array<{ toolName: string; input: unknown }> = [];

      const agent = v3.agent({
        mode: "dom",
        model: "anthropic/claude-haiku-4-5-20251001",
      });

      const page = v3.context.pages()[0];
      await page.goto("https://example.com");

      await agent.execute({
        instruction:
          "Use the ariaTree to understand the page, then provide the final requested output or a summary of the page.",
        maxSteps: 5,
        callbacks: {
          onStepFinish: async (event: StepResult<ToolSet>) => {
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

      // Should have captured tool calls
      expect(toolCalls.length).toBeGreaterThan(0);

      // Should include ariaTree (DOM mode emphasizes aria-based interaction)
      const toolNames = toolCalls.map((tc) => tc.toolName);
      expect(toolNames).toContain("ariaTree");
    });
  });

  test.describe("Scroll tool variants by mode", () => {
    test("DOM mode uses simple scroll tool without coordinates", () => {
      const tools = createAgentTools(v3, { mode: "dom" });

      expect(tools).toHaveProperty("scroll");
      // The DOM scroll tool should exist
      expect(typeof tools.scroll).toBe("object");
    });

    test("Hybrid mode uses vision scroll tool with optional coordinates", () => {
      const tools = createAgentTools(v3, { mode: "hybrid" });

      expect(tools).toHaveProperty("scroll");
      // The hybrid scroll tool should exist
      expect(typeof tools.scroll).toBe("object");
    });
  });

  test.describe("Keys tool availability in both modes", () => {
    test("Keys tool is available in DOM mode", () => {
      const tools = createAgentTools(v3, { mode: "dom" });
      expect(tools).toHaveProperty("keys");
    });

    test("Keys tool is available in hybrid mode", () => {
      const tools = createAgentTools(v3, { mode: "hybrid" });
      expect(tools).toHaveProperty("keys");
    });
  });

  test.describe("Think tool availability", () => {
    test("Think tool is available in DOM mode", () => {
      const tools = createAgentTools(v3, { mode: "dom" });
      expect(tools).toHaveProperty("think");
    });

    test("Think tool is available in hybrid mode", () => {
      const tools = createAgentTools(v3, { mode: "hybrid" });
      expect(tools).toHaveProperty("think");
    });
  });
});
