import { describe, expect, it } from "vitest";
import { extractModelName, resolveModel } from "../lib/modelUtils.js";

describe("extractModelName", () => {
  it("returns undefined for undefined input", () => {
    expect(extractModelName(undefined)).toBeUndefined();
  });

  it("returns the string as-is for a string input", () => {
    expect(extractModelName("openai/gpt-4o")).toBe("openai/gpt-4o");
  });

  it("returns modelName from an object input", () => {
    expect(
      extractModelName({ modelName: "anthropic/claude-sonnet-4-20250514" }),
    ).toBe("anthropic/claude-sonnet-4-20250514");
  });

  it("returns modelName from an object with extra properties", () => {
    expect(
      extractModelName({
        modelName: "openai/gpt-4o-mini",
        apiKey: "sk-test",
        baseURL: "https://custom.endpoint",
      }),
    ).toBe("openai/gpt-4o-mini");
  });
});

describe("resolveModel", () => {
  it("extracts provider and modelName from a string", () => {
    const result = resolveModel("openai/gpt-4o");
    expect(result.provider).toBe("openai");
    expect(result.modelName).toBe("gpt-4o");
    expect(result.clientOptions).toEqual({});
  });

  it("extracts clientOptions from an object config", () => {
    const result = resolveModel({
      modelName: "openai/gpt-4o" as never,
      apiKey: "sk-test",
    });
    expect(result.provider).toBe("openai");
    expect(result.modelName).toBe("gpt-4o");
    expect(result.clientOptions).toMatchObject({ apiKey: "sk-test" });
    // modelName should not leak into clientOptions
    expect(result.clientOptions).not.toHaveProperty("modelName");
  });
});
