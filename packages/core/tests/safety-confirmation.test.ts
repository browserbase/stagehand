import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock types to test the safety confirmation logic in isolation
type SafetyCheck = {
  id: string;
  code: string;
  message: string;
};

type SafetyConfirmationResponse = {
  acknowledged: boolean;
};

type SafetyConfirmationHandler = (
  checks: SafetyCheck[],
) => Promise<SafetyConfirmationResponse>;

// Extracted logic that mirrors OpenAICUAClient.handleSafetyConfirmation
async function handleSafetyConfirmation(
  pendingSafetyChecks: SafetyCheck[],
  handler: SafetyConfirmationHandler | undefined,
): Promise<SafetyCheck[] | undefined> {
  if (handler) {
    const response = await handler(pendingSafetyChecks);
    if (response.acknowledged) {
      return pendingSafetyChecks;
    } else {
      return undefined;
    }
  }
  // Auto-acknowledge when no handler
  return pendingSafetyChecks;
}

// Extracted logic that mirrors GoogleCUAClient.handleSafetyConfirmation
async function handleGoogleSafetyConfirmation(
  safetyDecision: unknown,
  handler: SafetyConfirmationHandler | undefined,
): Promise<string | undefined> {
  const safetyMessage =
    typeof safetyDecision === "object"
      ? JSON.stringify(safetyDecision, null, 2)
      : String(safetyDecision);

  const safetyChecks: SafetyCheck[] = [
    {
      id: "google-safety-decision",
      code: "safety_decision",
      message: safetyMessage,
    },
  ];

  if (handler) {
    const response = await handler(safetyChecks);
    if (response.acknowledged) {
      return "true";
    } else {
      return undefined;
    }
  }
  // Auto-acknowledge when no handler
  return "true";
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
      const handler = vi.fn().mockResolvedValue({ acknowledged: true });
      const result = await handleSafetyConfirmation(mockChecks, handler);

      expect(handler).toHaveBeenCalledWith(mockChecks);
      expect(result).toEqual(mockChecks);
    });

    it("returns undefined when handler rejects", async () => {
      const handler = vi.fn().mockResolvedValue({ acknowledged: false });
      const result = await handleSafetyConfirmation(mockChecks, handler);

      expect(handler).toHaveBeenCalledWith(mockChecks);
      expect(result).toBeUndefined();
    });

    it("auto-acknowledges when no handler is set", async () => {
      const result = await handleSafetyConfirmation(mockChecks, undefined);
      expect(result).toEqual(mockChecks);
    });
  });

  describe("Google-style (safety_decision)", () => {
    const mockDecision = {
      decision: "require_confirmation",
      explanation: "Cookie consent dialog detected",
    };

    it("returns 'true' when handler acknowledges", async () => {
      const handler = vi.fn().mockResolvedValue({ acknowledged: true });
      const result = await handleGoogleSafetyConfirmation(
        mockDecision,
        handler,
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
      const handler = vi.fn().mockResolvedValue({ acknowledged: false });
      const result = await handleGoogleSafetyConfirmation(
        mockDecision,
        handler,
      );

      expect(handler).toHaveBeenCalled();
      expect(result).toBeUndefined();
    });

    it("auto-acknowledges when no handler is set", async () => {
      const result = await handleGoogleSafetyConfirmation(
        mockDecision,
        undefined,
      );
      expect(result).toBe("true");
    });

    it("handles string safety decisions", async () => {
      const handler = vi.fn().mockResolvedValue({ acknowledged: true });
      const result = await handleGoogleSafetyConfirmation(
        "Simple string decision",
        handler,
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
