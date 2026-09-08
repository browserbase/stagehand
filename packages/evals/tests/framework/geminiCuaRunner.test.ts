import { GEMINI_CUA_TOOL_INSTRUCTIONS } from "../../framework/geminiCuaToolAdapter.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EvalsError } from "../../errors.js";
afterEach(() => vi.unstubAllEnvs());
import type { GeminiGenerateClient } from "@browserbasehq/stagehand-integrations-gemini-cua-sdk";
import type { AvailableModel } from "stagehand-v3";
import { runGeminiCuaAgent, assertGeminiCuaModel } from "../../framework/geminiCuaRunner.js";
import { EVAL_SYSTEM_PROMPT } from "../../framework/evalSystemPrompt.js";
import { EvalLogger } from "../../logger.js";

describe("Gemini CUA eval system prompt", () => {
  it("sends the common policy once through the native system channel", async () => {
    vi.stubEnv("EVAL_GEMINI_CUA_MAX_TURNS", "3");
    vi.stubEnv("AGENT_EVAL_MAX_STEPS", "9");
    let request: Record<string, unknown> | undefined;
    const client: GeminiGenerateClient = {
      generateContent: async (params) => {
        request = params;
        return {
          candidates: [
            {
              content: { parts: [{ text: 'EVAL_RESULT: {"success":true}' }] },
              finishReason: "STOP",
            },
          ],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
        };
      },
    };
    const instruction = "Find the item and stop before the final purchase.";
    const result = await runGeminiCuaAgent({
      plan: {
        dataset: "webvoyager",
        taskId: "cua-system-prompt",
        startUrl: "https://example.com",
        instruction,
      },
      model: "google/gemini-3.8-flash" as AvailableModel,
      logger: new EvalLogger(false),
      client,
      toolAdapter: {
        toolSurface: "google_computer_use",
        startupProfile: "tool_launch_local",
        browserSession: { provider: "local" },
        promptInstructions: GEMINI_CUA_TOOL_INSTRUCTIONS,
        executor: {
          execute: async () => {
            throw new Error("This recording client does not request tools.");
          },
        },
        facade: {
          run: async () => "",
          screenshot: async () => ({ data: "png", mimeType: "image/png" }),
        },
        observedToolMatcher: () => true,
        cleanup: async () => {},
      },
    });

    expect(result._success).toBe(true);
    expect(result).toMatchObject({ metrics: { step_budget: { value: 3 } } });
    expect(
      String((request?.config as { systemInstruction?: string })?.systemInstruction).split(
        EVAL_SYSTEM_PROMPT,
      ),
    ).toHaveLength(2);
    expect((request?.config as { systemInstruction?: string })?.systemInstruction).toContain(
      "computer use only",
    );
    expect((request?.config as { systemInstruction?: string })?.systemInstruction).toContain(
      "requested EVAL_RESULT line",
    );
    const messages = JSON.stringify(request?.contents);
    expect(messages).not.toContain(EVAL_SYSTEM_PROMPT);
    expect(messages).toContain(instruction);
    expect(messages).toContain("Browser tool surface: Gemini Computer Use.");
    expect(messages).not.toContain("Stagehand Playwright facade");
    expect(messages).not.toContain("exactly three tools");
    expect(messages).not.toContain("run, snapshot, screenshot");
  });
});

it("lets the native provider validate model identifiers", () => {
  expect(() => assertGeminiCuaModel("google/gemini-3.8-flash")).not.toThrow();
  expect(() => assertGeminiCuaModel("future-model")).not.toThrow();
  expect(() => assertGeminiCuaModel("projects/p/models/custom")).not.toThrow();
  expect(() => assertGeminiCuaModel("other-provider/custom")).not.toThrow();
  expect(() => assertGeminiCuaModel("google/")).toThrow(EvalsError);
});
