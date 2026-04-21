import { describe, it, expect, afterEach } from "vitest";
import { exec } from "child_process";
import { promises as fs } from "fs";
import * as path from "path";
import * as os from "os";

const CLI_PATH = path.join(__dirname, "../dist/index.js");
const TEST_SESSION = `connect-test-${Date.now()}`;

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
    `browse-${session}.context`,
    `browse-${session}.connect`,
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

describe("Browse CLI --connect flag", () => {
  afterEach(async () => {
    await browse("stop --force");
    await cleanupSession(TEST_SESSION);
  });

  it("rejects --connect in local mode", async () => {
    // `open` routes through runCommand() where --connect validation happens
    const result = await browse(
      "--connect fake-session-id open https://example.com",
      {
        env: {
          ...process.env,
          BROWSERBASE_API_KEY: "",
        },
      },
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(
      "--connect is only supported in remote mode",
    );
  });

  it("rejects --connect with --context-id on open", async () => {
    const result = await browse(
      "--connect fake-session-id open --context-id fake-ctx-id https://example.com",
      {
        env: {
          ...process.env,
          BROWSERBASE_API_KEY: "test-key",
        },
      },
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(
      "--context-id cannot be used with --connect",
    );
  });

  it("writes connect file when --connect is provided", async () => {
    const tmpDir = os.tmpdir();
    const connectPath = path.join(tmpDir, `browse-${TEST_SESSION}.connect`);

    // open routes through runCommand() which writes the connect file before
    // ensureDaemon(). The daemon will fail (fake API key) but the file should
    // still be written.
    await browse("--connect test-bb-session-123 open https://example.com", {
      env: {
        ...process.env,
        BROWSERBASE_API_KEY: "test-key",
      },
    });

    let content: string | null = null;
    try {
      content = (await fs.readFile(connectPath, "utf-8")).trim();
    } catch {
      // File may not exist if cleanup ran
    }
    expect(content).toBe("test-bb-session-123");
  });

  it("clears connect file when --connect is not provided", async () => {
    const tmpDir = os.tmpdir();
    const connectPath = path.join(tmpDir, `browse-${TEST_SESSION}.connect`);

    // Pre-create a connect file
    await fs.writeFile(connectPath, "old-session-id");

    // `open` routes through runCommand() which clears the connect file when
    // --connect is absent. The command itself may fail (no daemon) but the
    // file cleanup happens first.
    await browse("open https://example.com");

    let exists = true;
    try {
      await fs.access(connectPath);
    } catch {
      exists = false;
    }
    expect(exists).toBe(false);
  });

  it("status includes browserbaseSessionId field", async () => {
    const result = await browse("status");
    expect(result.exitCode).toBe(0);

    const data = parseJson(result.stdout);
    expect("browserbaseSessionId" in data).toBe(true);
    expect(data.browserbaseSessionId).toBeNull();
  });
});
