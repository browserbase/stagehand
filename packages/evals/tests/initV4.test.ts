import { describe, expect, it } from "vitest";
import type { StagehandClientInitParams } from "@browserbasehq/stagehand";
import { buildV4InitParams } from "../initV4.js";

describe("buildV4InitParams", () => {
  it("passes task-specific system instructions to the v4 SDK", () => {
    const model = {
      modelName: "openai/gpt-5.4-mini",
      apiKey: "test-key",
    } as NonNullable<StagehandClientInitParams["model"]>;

    expect(
      buildV4InitParams({
        env: "LOCAL",
        model,
        systemPrompt: "Treat secret12345 as a custom instruction.",
      }),
    ).toMatchObject({
      systemPrompt: "Treat secret12345 as a custom instruction.",
    });
  });
});
