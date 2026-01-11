import { describe, expect, it } from "vitest";
import { V3AgentHandler } from "../lib/v3/handlers/v3AgentHandler";

/**
 * Test suite for V3AgentHandler's providerOptions merging functionality.
 *
 * Tests the buildProviderOptions and deepMerge methods that allow users
 * to pass custom providerOptions (like thinkingConfig) while preserving
 * default options for specific models (like Gemini 3's mediaResolution).
 *
 * @see https://github.com/browserbase/stagehand/issues/1524
 */
describe("V3AgentHandler providerOptions", () => {
  // Helper to create a handler with specific userProviderOptions
  function createHandler(
    userProviderOptions?: Record<string, unknown>,
  ): V3AgentHandler {
    // Create handler with minimal dependencies (null/undefined for unused params)
    // We only need to test the providerOptions logic, not the full agent
    return new V3AgentHandler(
      null as unknown as ConstructorParameters<typeof V3AgentHandler>[0],
      () => {},
      null as unknown as ConstructorParameters<typeof V3AgentHandler>[2],
      undefined,
      undefined,
      undefined,
      undefined,
      userProviderOptions,
    );
  }

  // Access private method for testing
  function buildProviderOptions(
    handler: V3AgentHandler,
    modelId: string,
  ): unknown {
    return (handler as unknown as { buildProviderOptions: (id: string) => unknown }).buildProviderOptions(modelId);
  }

  describe("buildProviderOptions", () => {
    describe("with no user options", () => {
      it("returns undefined for non-Gemini3 models", () => {
        const handler = createHandler();
        expect(buildProviderOptions(handler, "anthropic/claude-sonnet-4")).toBeUndefined();
        expect(buildProviderOptions(handler, "openai/gpt-4o")).toBeUndefined();
        expect(buildProviderOptions(handler, "google/gemini-2.5-flash")).toBeUndefined();
      });

      it("returns default mediaResolution for Gemini 3 models", () => {
        const handler = createHandler();
        const result = buildProviderOptions(handler, "google/gemini-3-flash-preview");

        expect(result).toEqual({
          google: { mediaResolution: "MEDIA_RESOLUTION_HIGH" },
        });
      });

      it("detects Gemini 3 in various model ID formats", () => {
        const handler = createHandler();

        expect(buildProviderOptions(handler, "gemini-3-flash")).toEqual({
          google: { mediaResolution: "MEDIA_RESOLUTION_HIGH" },
        });
        expect(buildProviderOptions(handler, "vertex/gemini-3-flash-preview")).toEqual({
          google: { mediaResolution: "MEDIA_RESOLUTION_HIGH" },
        });
        expect(buildProviderOptions(handler, "google/gemini-3-pro")).toEqual({
          google: { mediaResolution: "MEDIA_RESOLUTION_HIGH" },
        });
      });
    });

    describe("with user options", () => {
      it("returns user options for non-Gemini3 models", () => {
        const userOptions = {
          google: {
            thinkingConfig: { includeThoughts: true, thinkingBudget: 8192 },
          },
        };
        const handler = createHandler(userOptions);
        const result = buildProviderOptions(handler, "vertex/gemini-2.5-flash");

        expect(result).toEqual(userOptions);
      });

      it("merges user options with Gemini 3 defaults", () => {
        const userOptions = {
          google: {
            thinkingConfig: { includeThoughts: true },
          },
        };
        const handler = createHandler(userOptions);
        const result = buildProviderOptions(handler, "google/gemini-3-flash-preview");

        expect(result).toEqual({
          google: {
            mediaResolution: "MEDIA_RESOLUTION_HIGH",
            thinkingConfig: { includeThoughts: true },
          },
        });
      });

      it("user options override Gemini 3 defaults when conflicting", () => {
        const userOptions = {
          google: {
            mediaResolution: "MEDIA_RESOLUTION_LOW",
          },
        };
        const handler = createHandler(userOptions);
        const result = buildProviderOptions(handler, "google/gemini-3-flash-preview");

        expect(result).toEqual({
          google: { mediaResolution: "MEDIA_RESOLUTION_LOW" },
        });
      });

      it("preserves nested user options during merge", () => {
        const userOptions = {
          google: {
            thinkingConfig: {
              includeThoughts: true,
              thinkingBudget: 16384,
            },
            customOption: "value",
          },
          otherProvider: {
            setting: true,
          },
        };
        const handler = createHandler(userOptions);
        const result = buildProviderOptions(handler, "google/gemini-3-flash-preview");

        expect(result).toEqual({
          google: {
            mediaResolution: "MEDIA_RESOLUTION_HIGH",
            thinkingConfig: {
              includeThoughts: true,
              thinkingBudget: 16384,
            },
            customOption: "value",
          },
          otherProvider: {
            setting: true,
          },
        });
      });
    });
  });

  describe("deepMerge", () => {
    // Access private method for testing
    function deepMerge(
      handler: V3AgentHandler,
      target: Record<string, unknown>,
      source: Record<string, unknown>,
    ): Record<string, unknown> {
      return (handler as unknown as {
        deepMerge: (t: Record<string, unknown>, s: Record<string, unknown>) => Record<string, unknown>;
      }).deepMerge(target, source);
    }

    const handler = createHandler();

    it("merges flat objects", () => {
      const result = deepMerge(handler, { a: 1 }, { b: 2 });
      expect(result).toEqual({ a: 1, b: 2 });
    });

    it("source values override target values", () => {
      const result = deepMerge(handler, { a: 1 }, { a: 2 });
      expect(result).toEqual({ a: 2 });
    });

    it("deeply merges nested objects", () => {
      const result = deepMerge(
        handler,
        { nested: { a: 1, b: 2 } },
        { nested: { b: 3, c: 4 } },
      );
      expect(result).toEqual({ nested: { a: 1, b: 3, c: 4 } });
    });

    it("replaces arrays instead of merging them", () => {
      const result = deepMerge(
        handler,
        { arr: [1, 2, 3] },
        { arr: [4, 5] },
      );
      expect(result).toEqual({ arr: [4, 5] });
    });

    it("handles null values in source", () => {
      const result = deepMerge(
        handler,
        { a: { nested: true } },
        { a: null },
      );
      expect(result).toEqual({ a: null });
    });

    it("preserves target when source nested value is null", () => {
      const result = deepMerge(
        handler,
        { a: { nested: true }, b: 1 },
        { a: null, b: 2 },
      );
      expect(result).toEqual({ a: null, b: 2 });
    });

    it("does not mutate original objects", () => {
      const target = { a: { b: 1 } };
      const source = { a: { c: 2 } };
      const result = deepMerge(handler, target, source);

      expect(target).toEqual({ a: { b: 1 } });
      expect(source).toEqual({ a: { c: 2 } });
      expect(result).toEqual({ a: { b: 1, c: 2 } });
    });
  });
});
