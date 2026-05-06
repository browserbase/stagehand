import { describe, expect, it } from "vitest";
import {
  ClaudeAgentHarness,
  CodexAgentHarness,
  getBenchHarness,
  StagehandAgentV3Harness,
  StagehandAgentV4Harness,
} from "../../framework/benchHarness.js";

describe("bench harness registry", () => {
  it("registers stagehand_v3 as the v3 Stagehand agent harness", () => {
    const harness = getBenchHarness("stagehand_v3");

    expect(harness).toBe(StagehandAgentV3Harness);
    expect(harness.supportsApi).toBe(true);
  });

  it("registers stagehand_v4 as the v4 Stagehand agent harness", () => {
    const harness = getBenchHarness("stagehand_v4");

    expect(harness).toBe(StagehandAgentV4Harness);
    expect(harness.supportsApi).toBe(false);
  });

  it("registers claude_code as a concrete executable harness", () => {
    const harness = getBenchHarness("claude_code");

    expect(harness).toBe(ClaudeAgentHarness);
    expect(harness.supportedTaskKinds).toEqual(["agent", "suite"]);
    expect(harness.supportsApi).toBe(false);
    expect(harness.execute).toBeDefined();
  });

  it("registers codex as a concrete executable harness", () => {
    const harness = getBenchHarness("codex");

    expect(harness).toBe(CodexAgentHarness);
    expect(harness.supportedTaskKinds).toEqual(["agent", "suite"]);
    expect(harness.supportsApi).toBe(false);
    expect(harness.execute).toBeDefined();
  });
});
