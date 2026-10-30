import { describe, expect, it } from "vitest";
import { resolveMastraModel } from "../src/session.js";

describe("Mastra model routing", () => {
  it.each([
    ["openai/example", "OPENAI_API_KEY"],
    ["anthropic/example", "ANTHROPIC_API_KEY"],
    ["google/example", "GOOGLE_API_KEY"],
    ["xai/example", "XAI_API_KEY"],
  ])("uses the native provider for %s when its credential is present", (model, key) => {
    expect(resolveMastraModel(model, { [key]: "fixture-key" })).toMatchObject({
      modelId: "example",
    });
    expect(resolveMastraModel(model, {})).toBe(model);
  });

  it("respects an explicit gateway route and the force-gateway override", () => {
    expect(resolveMastraModel("gateway/openai/example", { OPENAI_API_KEY: "fixture-key" })).toBe(
      "gateway/openai/example",
    );
    expect(
      resolveMastraModel("openai/example", {
        OPENAI_API_KEY: "fixture-key",
        MASTRA_FORCE_GATEWAY: "1",
      }),
    ).toBe("openai/example");
  });
});
