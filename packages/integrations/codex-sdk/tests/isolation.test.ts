import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isolatedCodexEnv } from "../src/isolation.js";

describe("Codex eval isolation", () => {
  it("copies only file auth, not plugins, config or inherited thread context", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codex-isolation-test-"));
    try {
      const original = path.join(directory, "original");
      await fs.mkdir(original);
      await fs.writeFile(path.join(original, "auth.json"), '{"tokens":{}}');
      await fs.writeFile(path.join(original, "config.toml"), "[mcp_servers.unrelated]");
      const env = await isolatedCodexEnv(path.join(directory, "eval"), {
        CODEX_HOME: original,
        CODEX_THREAD_ID: "host-thread",
        PATH: "/bin",
      });
      expect(env.CODEX_THREAD_ID).toBeUndefined();
      expect(env.PATH).toBe("/bin");
      expect(await fs.readdir(env.CODEX_HOME)).toEqual(["auth.json"]);
      expect((await fs.stat(path.join(env.CODEX_HOME, "auth.json"))).mode & 0o777).toBe(0o600);
      expect(env.HOME).not.toBe(os.homedir());
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});
