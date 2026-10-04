import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isolatedOpenCodeEnv } from "../src/isolation.js";

describe("OpenCode eval isolation", () => {
  it("uses a private home and drops operator OpenCode config paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-env-test-"));
    try {
      const env = await isolatedOpenCodeEnv(root, {
        PATH: "/usr/bin",
        HOME: "/operator",
        XDG_CONFIG_HOME: "/operator/.config",
        OPENCODE_CONFIG: "/operator/opencode.json",
        OPENCODE_CONFIG_DIR: "/operator/.opencode",
        OPENCODE_CONFIG_CONTENT: '{"model":"host"}',
        OPENCODE_DATA_DIR: "/operator/data",
        ANTHROPIC_API_KEY: "sk-ant-fixture",
        OPENCODE_MODEL: "anthropic/claude-sonnet-4-6",
      });
      expect(env.HOME).toBe(join(root, "home"));
      expect(env.XDG_CONFIG_HOME).toBe(join(root, "home", ".config"));
      expect(env.OPENCODE_CONFIG_DIR).toBe(root);
      expect(env.OPENCODE_CONFIG).toBeUndefined();
      expect(env.OPENCODE_CONFIG_CONTENT).toBeUndefined();
      expect(env.OPENCODE_DATA_DIR).toBeUndefined();
      expect(env.ANTHROPIC_API_KEY).toBe("sk-ant-fixture");
      expect(env.OPENCODE_MODEL).toBe("anthropic/claude-sonnet-4-6");
      expect(env.PATH).toBe("/usr/bin");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
