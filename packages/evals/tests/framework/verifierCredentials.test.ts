import { afterEach, describe, expect, it, vi } from "vitest";
import type { V3 } from "stagehand-v3";
import { V3Evaluator } from "stagehand-v3";
import { createVerifierEvaluator } from "../../framework/verifierAdapter.js";

vi.mock("stagehand-v3", async (importOriginal) => {
  const original = await importOriginal<typeof import("stagehand-v3")>();
  return {
    ...original,
    V3Evaluator: vi.fn(function () {}),
  };
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("gateway verifier credentials", () => {
  it("passes the gateway key to the selected judge", () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", " gateway-test-key ");
    const carrier = {} as V3;
    createVerifierEvaluator(carrier, "gateway/google/gemini-3.5-flash");
    expect(V3Evaluator).toHaveBeenCalledWith(carrier, {
      backend: "verifier",
      modelName: "gateway/google/gemini-3.5-flash",
      modelClientOptions: { apiKey: "gateway-test-key" },
    });
  });

  it.each([undefined, "", " "])("rejects a missing gateway key %j", (key) => {
    vi.stubEnv("AI_GATEWAY_API_KEY", key);
    expect(() => createVerifierEvaluator({} as V3, "gateway/google/gemini-3.5-flash")).toThrow(
      'no API key was found for provider "gateway"',
    );
    expect(V3Evaluator).not.toHaveBeenCalled();
  });
});
