import { describe, expect, it } from "vitest";
import {
  claudeCodeHarness,
  getBenchHarness,
} from "../../framework/benchHarness.js";

describe("bench harness registry", () => {
  it("registers claude_code as a concrete executable harness", () => {
    const harness = getBenchHarness("claude_code");

    expect(harness).toBe(claudeCodeHarness);
    expect(harness.supportedTaskKinds).toEqual(["agent", "suite"]);
    expect(harness.supportsApi).toBe(false);
    expect(harness.execute).toBeDefined();
  });
});
