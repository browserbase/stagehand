import { describe, it, expect, beforeAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs";

const exec = promisify(execFile);

// Path to the built CLI binary
const CLI_PATH = path.resolve(
  __dirname,
  "..",
  "dist",
  "cli",
  "cli.js",
);

/**
 * Run the evals CLI with given args, return stdout/stderr.
 */
async function evals(
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await exec("node", [CLI_PATH, ...args], {
      timeout: 10_000,
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
    });
    return { stdout, stderr };
  } catch (err: any) {
    // execFile throws on non-zero exit — return the output anyway
    return { stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

describe("CLI entrypoint", () => {
  beforeAll(() => {
    if (!fs.existsSync(CLI_PATH)) {
      throw new Error(
        `CLI not built at ${CLI_PATH}. Run 'pnpm build:cli' first.`,
      );
    }
  });

  describe("help", () => {
    it("shows help with -h", async () => {
      const { stdout } = await evals(["-h"]);
      expect(stdout).toContain("Stagehand Evals CLI");
      expect(stdout).toContain("Commands");
      expect(stdout).toContain("run");
      expect(stdout).toContain("list");
      expect(stdout).toContain("config");
    });

    it("shows help with help command", async () => {
      const { stdout } = await evals(["help"]);
      expect(stdout).toContain("Stagehand Evals CLI");
    });
  });

  describe("list", () => {
    it("shows categories", async () => {
      const { stdout } = await evals(["list"]);
      expect(stdout).toContain("Available Evals");
      expect(stdout).toContain("act");
      expect(stdout).toContain("extract");
      expect(stdout).toContain("observe");
      expect(stdout).toContain("agent");
    });

    it("shows detailed tasks with --detailed", async () => {
      const { stdout } = await evals(["list", "--detailed"]);
      expect(stdout).toContain("Detailed Task List");
      // Should list actual task names
      expect(stdout).toContain("dropdown");
    });

    it("shows benchmarks", async () => {
      const { stdout } = await evals(["list"]);
      expect(stdout).toContain("Benchmarks");
      expect(stdout).toContain("gaia");
      expect(stdout).toContain("webvoyager");
    });
  });

  describe("config", () => {
    it("shows current config", async () => {
      const { stdout } = await evals(["config"]);
      expect(stdout).toContain("Current Configuration");
      expect(stdout).toContain("env:");
      expect(stdout).toContain("trials:");
      expect(stdout).toContain("concurrency:");
    });

    it("shows config path", async () => {
      const { stdout } = await evals(["config", "path"]);
      expect(stdout).toContain("evals.config.json");
    });
  });

  describe("run target validation", () => {
    it("rejects unknown eval name", async () => {
      const { stdout, stderr } = await evals([
        "run",
        "nonexistent_eval_xyz",
      ]);
      const output = stdout + stderr;
      expect(output).toContain("does not exist");
    });
  });
});
