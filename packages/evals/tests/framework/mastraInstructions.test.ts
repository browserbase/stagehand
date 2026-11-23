import { describe, expect, it } from "vitest";

import {
  MASTRA_BROWSER_INSTRUCTIONS,
  MASTRA_FINISH_CHECK_PROMPT,
  resolveMastraHarnessSettings,
} from "../../framework/mastraInstructions.js";

describe("resolveMastraHarnessSettings", () => {
  it("defaults to the browser instructions with the finish check and prompt caching on", () => {
    expect(resolveMastraHarnessSettings({})).toEqual({
      instructions: "browser",
      finishCheck: true,
      promptCaching: true,
    });
  });

  it("turns each default off on its own", () => {
    expect(resolveMastraHarnessSettings({ EVAL_MASTRA_INSTRUCTIONS: " Minimal " })).toMatchObject({
      instructions: "minimal",
      finishCheck: true,
    });
    for (const off of ["0", "false", "off", "no", " OFF "]) {
      expect(resolveMastraHarnessSettings({ EVAL_MASTRA_FINISH_CHECK: off }).finishCheck).toBe(
        false,
      );
      expect(resolveMastraHarnessSettings({ EVAL_MASTRA_PROMPT_CACHE: off }).promptCaching).toBe(
        false,
      );
    }
    // Anything else, including an unknown instruction set, keeps the default.
    expect(
      resolveMastraHarnessSettings({
        EVAL_MASTRA_INSTRUCTIONS: "other",
        EVAL_MASTRA_FINISH_CHECK: "1",
        EVAL_MASTRA_PROMPT_CACHE: "",
      }),
    ).toEqual({ instructions: "browser", finishCheck: true, promptCaching: true });
  });
});

describe("Mastra harness prompts", () => {
  it("name no site, task or benchmark", () => {
    for (const prompt of [MASTRA_BROWSER_INSTRUCTIONS, MASTRA_FINISH_CHECK_PROMPT]) {
      expect(prompt).not.toMatch(/hardbench|webvoyager|mind2web|rubric|\.com\b/i);
    }
  });
});
