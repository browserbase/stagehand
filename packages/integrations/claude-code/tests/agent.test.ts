import { FACADE_TOOLS } from "@browserbasehq/stagehand-integrations/facade";
import { buildAllowlistedEnv } from "@browserbasehq/stagehand-integrations/harness";
import { describe, expect, it } from "vitest";

import { STAGEHAND_TOOL_NAMES } from "../src/agent.ts";

describe("claude-code stagehand example", () => {
  it("allows exactly the namespaced facade tools", () => {
    const expected = FACADE_TOOLS.map((tool) => `mcp__stagehand__${tool.name}`).sort();
    expect([...STAGEHAND_TOOL_NAMES].sort()).toEqual(expected);
  });

  it("allowlist excludes non-STAGEHAND/BROWSERBASE host vars", () => {
    process.env.STAGEHAND_BROWSER = "local";
    process.env.NOT_ALLOWLISTED_SECRET = "must-not-cross";
    try {
      const env = buildAllowlistedEnv();
      expect(env.STAGEHAND_BROWSER).toBe("local");
      expect(env).not.toHaveProperty("NOT_ALLOWLISTED_SECRET");
    } finally {
      delete process.env.STAGEHAND_BROWSER;
      delete process.env.NOT_ALLOWLISTED_SECRET;
    }
  });
});
