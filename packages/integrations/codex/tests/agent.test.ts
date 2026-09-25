import { buildAllowlistedEnv } from "@browserbasehq/stagehand-integrations/harness";
import { describe, expect, it } from "vitest";

import { buildCodexConfig } from "../src/agent.ts";

describe("codex stagehand example", () => {
  it("mounts the facade server in the config override", () => {
    const config = buildCodexConfig() as {
      mcp_servers: { stagehand: { command: string; args: string[]; env: Record<string, string> } };
    };
    expect(config.mcp_servers.stagehand.command).toBe(process.execPath);
    expect(config.mcp_servers.stagehand.args[0]).toMatch(/facade\/stdio-server\.mjs$/);
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
