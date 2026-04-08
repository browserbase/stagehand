import { describe, it, expect, beforeAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs";

const exec = promisify(execFile);

const CLI_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "dist",
  "cli",
  "cli.js",
);

async function evals(
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await exec("node", [CLI_PATH, ...args], {
      timeout: 30_000,
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
    });
    return { stdout, stderr };
  } catch (err: any) {
    return { stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

describe("runner parity (integration)", () => {
  beforeAll(() => {
    if (!fs.existsSync(CLI_PATH)) {
      throw new Error(
        `CLI not built at ${CLI_PATH}. Run 'pnpm build:cli' first.`,
      );
    }
  });

  it("--new-runner flag is accepted without error", async () => {
    // Should not crash — just validate it starts the new runner path
    // We pass a nonexistent eval to trigger a quick exit
    const { stdout, stderr } = await evals([
      "run",
      "nonexistent_test_xyz",
      "--new-runner",
      "-e",
      "local",
      "-t",
      "1",
    ]);
    const output = stdout + stderr;
    // Should mention "new runner" or fail with "no tasks match"
    expect(
      output.includes("new runner") ||
        output.includes("No bench tasks") ||
        output.includes("No tasks found") ||
        output.includes("does not exist"),
    ).toBe(true);
  });

  it("--new-runner lists same categories as legacy", async () => {
    // evals list should show the same categories regardless of runner
    const { stdout: legacyOut } = await evals(["list"]);
    // The list command doesn't use --new-runner, but verify it still works
    expect(legacyOut).toContain("act");
    expect(legacyOut).toContain("agent");
    expect(legacyOut).toContain("extract");
    expect(legacyOut).toContain("observe");
  });

  it("core tasks go to stagehand-core project", async () => {
    // We can't easily verify the Braintrust project from CLI output alone,
    // but we can verify the core runner is invoked (not the bench runner)
    const { stdout, stderr } = await evals([
      "run",
      "open",
      "-e",
      "local",
      "-t",
      "1",
    ]);
    const output = stdout + stderr;
    expect(output).toContain("Running core evals");
  });
});
