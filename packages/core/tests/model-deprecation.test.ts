import { describe, expect, it } from "vitest";
import { LLMProvider } from "../lib/v3/llm/LLMProvider";
import {
  UnsupportedModelError,
  UnsupportedAISDKModelProviderError,
} from "../lib/v3/types/public/sdkErrors";
import type { LogLine } from "../lib/v3/types/public/logs";

// Mock client options with fake API keys for testing
const mockClientOptions = { apiKey: "test-api-key-for-testing" };

describe("Model format deprecation", () => {
  describe("UnsupportedModelError", () => {
    it("includes guidance to use provider/model format for unknown model names", () => {
      const error = new UnsupportedModelError([
        "gpt-4o",
        "claude-3-5-sonnet-latest",
      ]);

      // Should mention the new format
      expect(error.message).toContain("provider/model");
      // Should include link to docs
      expect(error.message).toContain(
        "https://docs.stagehand.dev/v3/configuration/models",
      );
    });

    it("includes example of provider/model format", () => {
      const error = new UnsupportedModelError(["gpt-4o"]);

      // Should provide examples like openai/gpt-4o
      expect(error.message).toContain("openai/gpt-4o");
      expect(error.message).toContain("anthropic/claude-sonnet-4");
    });

    it("works with feature parameter", () => {
      const error = new UnsupportedModelError(["gpt-4o"], "extract");

      expect(error.message).toContain("extract");
      expect(error.message).toContain("provider/model");
      expect(error.message).toContain(
        "https://docs.stagehand.dev/v3/configuration/models",
      );
    });
  });

  describe("LLMProvider.getClient deprecation warning", () => {
    it("logs deprecation warning for legacy model names", () => {
      const logs: LogLine[] = [];
      const logger = (line: LogLine) => logs.push(line);
      const provider = new LLMProvider(logger);

      // Using a legacy model name like "gpt-4o" instead of "openai/gpt-4o"
      // Should not throw, but should log a deprecation warning
      const client = provider.getClient("gpt-4o", mockClientOptions);

      // Should return a client (not throw)
      expect(client).toBeDefined();

      // Should have logged a deprecation warning at level 0
      const deprecationWarning = logs.find(
        (log) =>
          log.message.toLowerCase().includes("deprecated") ||
          log.message.toLowerCase().includes("deprecation"),
      );
      expect(deprecationWarning).toBeDefined();
      expect(deprecationWarning!.level).toBe(0);
    });

    it("deprecation warning mentions provider/model format", () => {
      const logs: LogLine[] = [];
      const logger = (line: LogLine) => logs.push(line);
      const provider = new LLMProvider(logger);

      provider.getClient("gpt-4o", mockClientOptions);

      const deprecationWarning = logs.find(
        (log) =>
          log.message.toLowerCase().includes("deprecated") ||
          log.message.toLowerCase().includes("deprecation"),
      );

      expect(deprecationWarning).toBeDefined();
      const message = deprecationWarning!.message;
      // Should mention the provider/model format
      expect(message).toContain("provider/model");
      // Should give an example
      expect(message).toContain("openai/gpt-5");
    });

    it("returns OpenAIClient for legacy OpenAI model names", () => {
      const logs: LogLine[] = [];
      const logger = (line: LogLine) => logs.push(line);
      const provider = new LLMProvider(logger);

      const client = provider.getClient("gpt-4o", mockClientOptions);

      // Should return a client
      expect(client).toBeDefined();
      // The client should be an OpenAIClient (check constructor name)
      expect(client.constructor.name).toBe("OpenAIClient");
    });

    it("returns AnthropicClient for legacy Anthropic model names", () => {
      const logs: LogLine[] = [];
      const logger = (line: LogLine) => logs.push(line);
      const provider = new LLMProvider(logger);

      const client = provider.getClient(
        "claude-3-5-sonnet-latest",
        mockClientOptions,
      );

      // Should return a client
      expect(client).toBeDefined();
      // The client should be an AnthropicClient
      expect(client.constructor.name).toBe("AnthropicClient");
    });
  });

  describe("LLMProvider.getClient error handling", () => {
    it("throws UnsupportedModelError for unknown model without slash", () => {
      const logs: LogLine[] = [];
      const logger = (line: LogLine) => logs.push(line);
      const provider = new LLMProvider(logger);

      // Unknown model without slash should throw UnsupportedModelError
      expect(() => {
        provider.getClient("some-unknown-model", mockClientOptions);
      }).toThrow(UnsupportedModelError);
    });

    it("UnsupportedModelError includes provider/model format guidance", () => {
      const logs: LogLine[] = [];
      const logger = (line: LogLine) => logs.push(line);
      const provider = new LLMProvider(logger);

      try {
        provider.getClient("some-unknown-model", mockClientOptions);
      } catch (error) {
        expect((error as Error).message).toContain("provider/model");
      }
    });

    it("throws UnsupportedAISDKModelProviderError for invalid provider in provider/model format", () => {
      const logs: LogLine[] = [];
      const logger = (line: LogLine) => logs.push(line);
      const provider = new LLMProvider(logger);

      // Invalid provider but correct format
      expect(() => {
        provider.getClient("invalid-provider/some-model", mockClientOptions);
      }).toThrow(UnsupportedAISDKModelProviderError);
    });

    it("UnsupportedAISDKModelProviderError lists valid providers", () => {
      const logs: LogLine[] = [];
      const logger = (line: LogLine) => logs.push(line);
      const provider = new LLMProvider(logger);

      try {
        provider.getClient("invalid-provider/some-model", mockClientOptions);
      } catch (error) {
        const message = (error as Error).message;
        // Should list valid providers
        expect(message).toContain("openai");
        expect(message).toContain("anthropic");
        expect(message).toContain("google");
      }
    });
  });

  describe("new provider/model format", () => {
    it("does not log deprecation warning for provider/model format", () => {
      const logs: LogLine[] = [];
      const logger = (line: LogLine) => logs.push(line);
      const provider = new LLMProvider(logger);

      // Using the new format
      const client = provider.getClient("openai/gpt-4o", mockClientOptions);

      expect(client).toBeDefined();

      // Should NOT have a deprecation warning
      const deprecationWarning = logs.find(
        (log) =>
          log.message.toLowerCase().includes("deprecated") ||
          log.message.toLowerCase().includes("deprecation"),
      );
      expect(deprecationWarning).toBeUndefined();
    });
  });
});
