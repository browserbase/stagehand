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
    `browse-${session}.local-config`,
    `browse-${session}.local-info`,
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

  it("shows isolated local strategy by default when local is desired", async () => {
    const result = await browse("env", {
      env: {
        ...process.env,
        BROWSERBASE_API_KEY: "",
      },
    });
    expect(result.exitCode).toBe(0);

    const data = parseJson(result.stdout);
    expect(data.mode).toBe("not running");
    expect(data.desired).toBe("local");
    expect(data.localStrategy).toBe("isolated");
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

  it("defaults browse env local to isolated strategy", async () => {
    const result = await browse("env local");
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("browse env local --auto-connect");

    const data = parseJson(result.stdout);
    expect(data.mode).toBe("local");
    expect(data.localStrategy).toBe("isolated");

    const statusResult = await browse("status");
    expect(statusResult.stderr).toContain("browse env local --auto-connect");

    const status = parseJson(statusResult.stdout);
    expect(status.running).toBe(true);
    expect(status.mode).toBe("local");
    expect(status.localStrategy).toBe("isolated");
  });

  it("uses auto strategy only when --auto-connect is passed", async () => {
    const result = await browse("env local --auto-connect");
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("without `--auto-connect`");

    const data = parseJson(result.stdout);
    expect(data.mode).toBe("local");
    expect(data.localStrategy).toBe("auto");

    const statusResult = await browse("status");
    expect(statusResult.stderr).toContain("without `--auto-connect`");

    const status = parseJson(statusResult.stdout);
    expect(status.running).toBe(true);
    expect(status.mode).toBe("local");
    expect(status.localStrategy).toBe("auto");
  });

  it("stores explicit CDP strategy when a target is provided", async () => {
    const result = await browse("env local 9222");
    expect(result.exitCode).toBe(0);

    const data = parseJson(result.stdout);
    expect(data.mode).toBe("local");
    expect(data.localStrategy).toBe("cdp");

    const status = parseJson((await browse("status")).stdout);
    expect(status.running).toBe(true);
    expect(status.mode).toBe("local");
    expect(status.localStrategy).toBe("cdp");
  });

  it("shows an isolated-browser hint when status reports an attached existing browser", async () => {
    await browse("env local");

    const tmpDir = os.tmpdir();
    await fs.writeFile(
      path.join(tmpDir, `browse-${TEST_SESSION}.local-config`),
      JSON.stringify({ strategy: "auto" }),
    );
    await fs.writeFile(
      path.join(tmpDir, `browse-${TEST_SESSION}.local-info`),
      JSON.stringify({
        localSource: "attached-existing",
        resolvedCdpUrl: "ws://127.0.0.1:9222/devtools/browser/abc123",
      }),
    );

    const statusResult = await browse("status");
    expect(statusResult.exitCode).toBe(0);
    expect(statusResult.stderr).toContain("without `--auto-connect`");

    const status = parseJson(statusResult.stdout);
    expect(status.localStrategy).toBe("auto");
    expect(status.localSource).toBe("attached-existing");
  });

  it("rejects conflicting local strategy options", async () => {
    const withAlias = await browse("env local --auto-connect --isolated");
    expect(withAlias.exitCode).not.toBe(0);
    expect(withAlias.stderr).toContain("Use only one of");

    const withTarget = await browse("env local --auto-connect 9222");
    expect(withTarget.exitCode).not.toBe(0);
    expect(withTarget.stderr).toContain("Use only one of");
  });
});
