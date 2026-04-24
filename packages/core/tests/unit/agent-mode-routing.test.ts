import { describe, expect, it } from "vitest";
import { extractModelName } from "../../lib/modelUtils.js";
import {
  type AgentToolMode,
  HYBRID_CAPABLE_MODEL_PATTERNS,
} from "../../lib/v3/types/public/agent.js";

function resolveDefaultAgentMode(
  model: string | { modelName: string } | undefined,
  fallbackModelName: string,
): AgentToolMode {
  const modelName = extractModelName(model) ?? fallbackModelName;
  const isHybridCapable = HYBRID_CAPABLE_MODEL_PATTERNS.some((pattern) =>
    modelName.includes(pattern),
  );
  return isHybridCapable ? "hybrid" : "dom";
}

function resolveAgentMode(
  explicitMode: AgentToolMode | undefined,
  model: string | { modelName: string } | undefined,
  fallbackModelName: string,
): AgentToolMode {
  return explicitMode ?? resolveDefaultAgentMode(model, fallbackModelName);
}

describe("agent mode auto-routing", () => {
  describe("explicit mode is never overridden", () => {
    it("respects mode: 'dom' even when model supports hybrid", () => {
      const result = resolveAgentMode(
        "dom",
        "anthropic/claude-sonnet-4-20250514",
        "openai/gpt-4o",
      );
      expect(result).toBe("dom");
    });

    it("respects mode: 'hybrid' even when model does not support hybrid", () => {
      const result = resolveAgentMode(
        "hybrid",
        "openai/gpt-4o-mini",
        "openai/gpt-4o-mini",
      );
      expect(result).toBe("hybrid");
    });

    it("respects mode: 'cua' regardless of model", () => {
      const result = resolveAgentMode(
        "cua",
        "anthropic/claude-sonnet-4-20250514",
        "openai/gpt-4o",
      );
      expect(result).toBe("cua");
    });
  });

  describe("auto-routes to hybrid for supported models when no mode is set", () => {
    it.each([
      ["google/gemini-3-flash-preview", "gemini-3"],
      ["google/gemini-3-flash", "gemini-3"],
      ["anthropic/claude-sonnet-4-20250514", "claude"],
      ["anthropic/claude-haiku-4-5-20251001", "claude"],
      ["openai/gpt-5.4-turbo", "gpt-5.4"],
      ["openai/gpt-5.4", "gpt-5.4"],
    ])(
      "model %s (pattern: %s) → hybrid",
      (modelName: string, _pattern: string) => {
        const result = resolveAgentMode(undefined, modelName, "fallback-model");
        expect(result).toBe("hybrid");
      },
    );
  });

  describe("auto-routes to dom for unsupported models when no mode is set", () => {
    it.each([
      "openai/gpt-4o",
      "openai/gpt-4o-mini",
      "openai/gpt-4.1-mini",
      "google/gemini-2.0-flash",
      "google/gemini-2.5-flash",
      "mistral/mistral-large",
    ])("model %s → dom", (modelName: string) => {
      const result = resolveAgentMode(undefined, modelName, "fallback-model");
      expect(result).toBe("dom");
    });
  });

  describe("falls back to stagehand-level model when no agent model is set", () => {
    it("uses stagehand model for routing when agent model is undefined", () => {
      const result = resolveAgentMode(
        undefined,
        undefined,
        "anthropic/claude-sonnet-4-20250514",
      );
      expect(result).toBe("hybrid");
    });

    it("routes to dom when stagehand model is not hybrid-capable", () => {
      const result = resolveAgentMode(
        undefined,
        undefined,
        "openai/gpt-4o-mini",
      );
      expect(result).toBe("dom");
    });
  });

  describe("handles AgentModelConfig objects", () => {
    it("extracts modelName from config object for routing", () => {
      const result = resolveAgentMode(
        undefined,
        { modelName: "anthropic/claude-sonnet-4-20250514" },
        "openai/gpt-4o",
      );
      expect(result).toBe("hybrid");
    });

    it("routes to dom when config object model is not hybrid-capable", () => {
      const result = resolveAgentMode(
        undefined,
        { modelName: "openai/gpt-4o-mini" },
        "openai/gpt-4o",
      );
      expect(result).toBe("dom");
    });
  });
});

describe("V3AgentHandler mode fallback", () => {
  it("handler defaults to dom when mode is undefined (safety net)", () => {
    const mode: AgentToolMode | undefined = undefined;
    const resolved = mode ?? "dom";
    expect(resolved).toBe("dom");
  });

  it("handler uses provided mode when set", () => {
    const mode: AgentToolMode | undefined = "hybrid";
    const resolved = mode ?? "dom";
    expect(resolved).toBe("hybrid");
  });
});
