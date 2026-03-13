import { describe, it, expect, afterEach } from "vitest";
import { exec } from "child_process";
import { promises as fs } from "fs";
import * as path from "path";
import * as os from "os";

const CLI_PATH = path.join(__dirname, "../dist/index.js");
const TEST_SESSION = `env-test-${Date.now()}`;

async function browse(
  args: string,
  options: { timeout?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const timeout = options.timeout ?? 30000;
  const env = { ...process.env, ...options.env };

  return new Promise((resolve) => {
    const fullArgs = `node ${CLI_PATH} --headless --session ${TEST_SESSION} ${args}`;
    exec(fullArgs, { timeout, env }, (error, stdout, stderr) => {
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: error?.code ?? 0,
      });
    });
  });
}

function parseJson<T = Record<string, unknown>>(output: string): T {
  try {
    return JSON.parse(output) as T;
  } catch {
    throw new Error(`Failed to parse JSON: ${output}`);
  }
}

async function cleanupSession(session: string): Promise<void> {
  const tmpDir = os.tmpdir();
  const patterns = [
    `browse-${session}.sock`,
    `browse-${session}.pid`,
    `browse-${session}.ws`,
    `browse-${session}.chrome.pid`,
    `browse-${session}.mode`,
    `browse-${session}.mode-override`,
  ];

  for (const pattern of patterns) {
    try {
      await fs.unlink(path.join(tmpDir, pattern));
    } catch {
      // Ignore missing files.
    }
  }

  try {
    await fs.rm(path.join(tmpDir, `browse-${session}-network`), {
      recursive: true,
    });
  } catch {
    // Ignore missing directory.
  }
}

describe("Browse CLI env command", () => {
  afterEach(async () => {
    await browse("stop --force");
    await cleanupSession(TEST_SESSION);
  });

  it("shows desired env even when daemon is not running", async () => {
    const result = await browse("env");
    expect(result.exitCode).toBe(0);

    const data = parseJson(result.stdout);
    expect(data.mode).toBe("not running");
    expect(["local", "remote"]).toContain(data.desired);
  });

  it("rejects unsupported env target", async () => {
    const result = await browse("env invalid-target");
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Usage: browse env [local|remote]");
  });

  it("rejects remote env without Browserbase credentials", async () => {
    const result = await browse("env remote", {
      env: {
        ...process.env,
        BROWSERBASE_API_KEY: "",
      },
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Remote mode requires BROWSERBASE_API_KEY");
  });
});
