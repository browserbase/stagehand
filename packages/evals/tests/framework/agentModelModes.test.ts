import { describe, expect, it } from "vitest";

import { inferDefaultStagehandAgentMode } from "../../framework/agentModelModes.js";

describe("agentModelModes", () => {
  it.each([
    "openai/gpt-5.6-terra",
    "openai/gpt-5.6-luna",
    "openai/gpt-5.6-sol",
  ])("defaults %s to hybrid mode", (modelName) => {
    expect(inferDefaultStagehandAgentMode(modelName)).toBe("hybrid");
  });
});
