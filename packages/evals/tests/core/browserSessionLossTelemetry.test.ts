import { describe, expect, it } from "vitest";
import {
  parseSessionLossTelemetry,
  SESSION_LOST_TELEMETRY_PREFIX,
} from "../../core/tools/browserSessionLoss.js";

function line(fields: Record<string, unknown>) {
  return (
    SESSION_LOST_TELEMETRY_PREFIX + JSON.stringify({ cause: "CDP connection closed", ...fields })
  );
}

describe("facade session loss diagnostics", () => {
  it("retains browser identity, measured age and configured timeout", () => {
    expect(
      parseSessionLossTelemetry(
        line({
          tool: "snapshot",
          at: "2026-09-08T00:00:00.000Z",
          provider: "browserbase",
          sessionId: "session-123",
          sessionAgeMs: 12_500,
          sessionTimeoutMs: 3_600_000,
        }),
      ),
    ).toEqual({
      cause: "CDP connection closed",
      tool: "snapshot",
      at: "2026-09-08T00:00:00.000Z",
      provider: "browserbase",
      sessionId: "session-123",
      sessionAgeMs: 12_500,
      sessionTimeoutMs: 3_600_000,
    });
  });

  it.each([-1, "12000", null, {}, 1e309])("drops invalid diagnostic durations: %j", (value) => {
    expect(
      parseSessionLossTelemetry(line({ sessionAgeMs: value, sessionTimeoutMs: value })),
    ).toEqual({ cause: "CDP connection closed" });
  });

  it("accepts zero age and omits invalid identity metadata", () => {
    expect(
      parseSessionLossTelemetry(line({ provider: "other", sessionId: 42, sessionAgeMs: 0 })),
    ).toEqual({ cause: "CDP connection closed", sessionAgeMs: 0 });
  });

  it("drops JSON numeric overflow without losing the terminal cause", () => {
    expect(
      parseSessionLossTelemetry(
        SESSION_LOST_TELEMETRY_PREFIX +
          '{"cause":"CDP connection closed","sessionAgeMs":1e309,"sessionTimeoutMs":1e309}',
      ),
    ).toEqual({ cause: "CDP connection closed" });
  });

  it("sanitizes string diagnostics while retaining valid numeric metadata", () => {
    const parsed = parseSessionLossTelemetry(
      line({
        provider: "local",
        sessionId: "wss://example.test/?apiKey=synthetic-key",
        sessionAgeMs: 1,
      }),
    );
    expect(parsed?.provider).toBe("local");
    expect(parsed?.sessionAgeMs).toBe(1);
    expect(JSON.stringify(parsed)).not.toContain("synthetic-key");
  });
});
