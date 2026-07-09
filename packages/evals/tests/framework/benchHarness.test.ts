import { describe, expect, it } from "vitest";
import {
  claudeCodeHarness,
  codexHarness,
  getBenchHarness,
  vercelAiSdkHarness,
} from "../../framework/benchHarness.js";

describe("bench harness registry", () => {
  it("registers claude_code as a concrete executable harness", () => {
    const harness = getBenchHarness("claude_code");

    expect(harness).toBe(claudeCodeHarness);
    expect(harness.supportedTaskKinds).toEqual(["agent", "suite"]);
    expect(harness.supportsApi).toBe(false);
    expect(harness.execute).toBeDefined();
  });

  it("registers codex as a concrete executable harness", () => {
    const harness = getBenchHarness("codex");

    expect(harness).toBe(codexHarness);
    expect(harness.supportedTaskKinds).toEqual(["agent", "suite"]);
    expect(harness.supportsApi).toBe(false);
    expect(harness.execute).toBeDefined();
  });

  it("registers vercel_ai_sdk as a concrete executable harness", async () => {
    const harness = getBenchHarness("vercel_ai_sdk");

    expect(harness).toBe(vercelAiSdkHarness);
    expect(harness.supportedTaskKinds).toEqual(["agent", "suite"]);
    expect(harness.supportsApi).toBe(false);
    expect(harness.execute).toBeDefined();
    // Like claude_code/codex, this harness runs via the execute path only.
    await expect(harness.start({} as never)).rejects.toThrow(
      /external harness execute path/,
    );
  });
});
