import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("OpenCode MCP process environment", () => {
  it("passes the explicit browser environment without host credentials", async () => {
    const root = await mkdtemp(join(tmpdir(), "stagehand-opencode-mcp-test-"));
    try {
      const specPath = join(root, "server.json");
      await writeFile(
        specPath,
        JSON.stringify({
          command: [
            process.execPath,
            "-e",
            "process.stdout.write(JSON.stringify({browser:process.env.STAGEHAND_BROWSER,leak:process.env.SECRET_LEAK??null}))",
          ],
          environment: { STAGEHAND_BROWSER: "browserbase" },
        }),
      );
      const output = await new Promise<string>((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [new URL("../src/mcp-wrapper.ts", import.meta.url).pathname, specPath],
          {
            env: { ...process.env, SECRET_LEAK: "hidden" },
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk: Buffer) => {
          stdout += chunk.toString();
        });
        child.stderr.on("data", (chunk: Buffer) => {
          stderr += chunk.toString();
        });
        child.once("error", reject);
        child.once("exit", (code) => (code === 0 ? resolve(stdout) : reject(new Error(stderr))));
      });
      expect(JSON.parse(output)).toEqual({ browser: "browserbase", leak: null });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
