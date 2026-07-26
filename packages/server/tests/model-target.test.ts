import { describe, expect, it } from "vitest";
import { ModelConfigSchema } from "../../protocol/schemas.js";
import { resolveModelTarget } from "../llm/modelTarget.js";

describe("resolveModelTarget", () => {
  it("resolves a cataloged provider model directly", () => {
    const config = ModelConfigSchema.parse({
      modelName: "openai/gpt-5.4-mini",
      apiKey: "provider-key",
    });

    expect(resolveModelTarget(config)).toEqual({
      type: "direct",
      modelName: "openai/gpt-5.4-mini",
      apiKey: "provider-key",
    });
  });

  it("resolves an unlisted provider model directly", () => {
    const config = ModelConfigSchema.parse({
      type: "unlisted",
      modelName: "openai/gpt-new-preview",
      apiKey: "provider-key",
    });

    expect(resolveModelTarget(config)).toEqual({
      type: "direct",
      modelName: "openai/gpt-new-preview",
      apiKey: "provider-key",
    });
  });

  it("uses the browserbase namespace to select the gateway", () => {
    const config = ModelConfigSchema.parse({
      modelName: "browserbase/openai/gpt-5.4-mini",
    });

    expect(resolveModelTarget(config)).toEqual({
      type: "browserbase",
      modelName: "openai/gpt-5.4-mini",
    });
  });

  it("preserves caller-controlled endpoint configuration", () => {
    const config = ModelConfigSchema.parse({
      modelName: "customer-deployment-42",
      baseURL: "https://customer.example.com/v1",
      apiKey: "customer-key",
    });

    expect(resolveModelTarget(config)).toEqual({
      type: "openai-compatible",
      modelName: "customer-deployment-42",
      baseURL: "https://customer.example.com/v1",
      apiKey: "customer-key",
    });
  });
});
