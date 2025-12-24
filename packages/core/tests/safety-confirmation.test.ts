import { describe, it, expect, vi } from "vitest";
import { OpenAICUAClient } from "../lib/v3/agent/OpenAICUAClient";
import { GoogleCUAClient } from "../lib/v3/agent/GoogleCUAClient";
import type {
  SafetyCheck,
  SafetyConfirmationHandler,
} from "../lib/v3/types/public/agent";
import type { LogLine } from "../lib/v3/types/public/logs";

type LoggerMock = (message: LogLine) => void;

const openAISafetyInvoker = (
  OpenAICUAClient.prototype as unknown as {
    handleSafetyConfirmation: (
      this: OpenAICUAClient,
      pendingSafetyChecks: SafetyCheck[],
      logger: LoggerMock,
    ) => Promise<SafetyCheck[] | undefined>;
  }
).handleSafetyConfirmation;

const googleSafetyInvoker = (
  GoogleCUAClient.prototype as unknown as {
    handleSafetyConfirmation: (
      this: GoogleCUAClient,
      safetyDecision: unknown,
      logger: LoggerMock,
    ) => Promise<string | undefined>;
  }
).handleSafetyConfirmation;

function createOpenAIClient(): OpenAICUAClient {
  return new OpenAICUAClient(
    "openai",
    "openai/computer-use-preview",
    "test instructions",
    { apiKey: "test" },
  );
}

function createGoogleClient(): GoogleCUAClient {
  return new GoogleCUAClient(
    "google",
    "google/gemini-2.5-computer-use-preview-10-2025",
    "test instructions",
    { apiKey: "test" },
  );
}

describe("Safety Confirmation Handler", () => {
  describe("OpenAI-style (pending_safety_checks)", () => {
    const mockChecks: SafetyCheck[] = [
      {
        id: "check-1",
        code: "malicious_instructions",
        message: "Potentially harmful action detected",
      },
    ];

    it("returns checks when handler acknowledges", async () => {
      const client = createOpenAIClient();
      const handler: SafetyConfirmationHandler = vi.fn(async () => ({
        acknowledged: true,
      }));
      client.setSafetyConfirmationHandler(handler);
      const logger = vi.fn<LoggerMock>();
      const result = await openAISafetyInvoker.call(client, mockChecks, logger);

      expect(handler).toHaveBeenCalledWith(mockChecks);
      expect(result).toEqual(mockChecks);
    });

    it("returns undefined when handler rejects", async () => {
      const client = createOpenAIClient();
      const handler: SafetyConfirmationHandler = vi.fn(async () => ({
        acknowledged: false,
      }));
      client.setSafetyConfirmationHandler(handler);
      const logger = vi.fn<LoggerMock>();
      const result = await openAISafetyInvoker.call(client, mockChecks, logger);

      expect(handler).toHaveBeenCalledWith(mockChecks);
      expect(result).toBeUndefined();
    });

    it("auto-acknowledges when no handler is set", async () => {
      const client = createOpenAIClient();
      const logger = vi.fn<LoggerMock>();
      const result = await openAISafetyInvoker.call(client, mockChecks, logger);
      expect(result).toEqual(mockChecks);
    });
  });

  describe("Google-style (safety_decision)", () => {
    const mockDecision = {
      decision: "require_confirmation",
      explanation: "Cookie consent dialog detected",
    };

    it("returns 'true' when handler acknowledges", async () => {
      const client = createGoogleClient();
      const handler: SafetyConfirmationHandler = vi.fn(async () => ({
        acknowledged: true,
      }));
      client.setSafetyConfirmationHandler(handler);
      const logger = vi.fn<LoggerMock>();
      const result = await googleSafetyInvoker.call(
        client,
        mockDecision,
        logger,
      );

      expect(handler).toHaveBeenCalledWith([
        {
          id: "google-safety-decision",
          code: "safety_decision",
          message: JSON.stringify(mockDecision, null, 2),
        },
      ]);
      expect(result).toBe("true");
    });

    it("returns undefined when handler rejects", async () => {
      const client = createGoogleClient();
      const handler: SafetyConfirmationHandler = vi.fn(async () => ({
        acknowledged: false,
      }));
      client.setSafetyConfirmationHandler(handler);
      const logger = vi.fn<LoggerMock>();
      const result = await googleSafetyInvoker.call(
        client,
        mockDecision,
        logger,
      );

      expect(handler).toHaveBeenCalled();
      expect(result).toBeUndefined();
    });

    it("auto-acknowledges when no handler is set", async () => {
      const client = createGoogleClient();
      const logger = vi.fn<LoggerMock>();
      const result = await googleSafetyInvoker.call(
        client,
        mockDecision,
        logger,
      );
      expect(result).toBe("true");
    });

    it("handles string safety decisions", async () => {
      const client = createGoogleClient();
      const handler: SafetyConfirmationHandler = vi.fn(async () => ({
        acknowledged: true,
      }));
      client.setSafetyConfirmationHandler(handler);
      const logger = vi.fn<LoggerMock>();
      const result = await googleSafetyInvoker.call(
        client,
        "Simple string decision",
        logger,
      );

      expect(handler).toHaveBeenCalledWith([
        {
          id: "google-safety-decision",
          code: "safety_decision",
          message: "Simple string decision",
        },
      ]);
      expect(result).toBe("true");
    });
  });
});
