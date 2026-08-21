import { describe, expect, it } from "vitest";
import {
  claudeCodeHarness,
  codexHarness,
  getBenchHarness,
  hermesHarness,
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

  it("registers hermes as a concrete executable harness", () => {
    const harness = getBenchHarness("hermes");

    expect(harness).toBe(hermesHarness);
    expect(harness.supportedTaskKinds).toEqual(["agent", "suite"]);
    expect(harness.supportsApi).toBe(false);
    expect(harness.execute).toBeDefined();
  });
});
