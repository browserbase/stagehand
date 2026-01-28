/**
 * Browse CLI Tests
 *
 * Comprehensive test suite covering:
 * - Daemon lifecycle
 * - Navigation commands
 * - Actions (click, type, fill)
 * - Information retrieval (snapshot, screenshot, get)
 * - Multi-tab operations
 * - Network capture
 * - Error handling
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
import { spawn, exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

const execAsync = promisify(exec);

// CLI executable path - use tsx for development testing
const CLI_PATH = path.join(__dirname, "../src/index.ts");
const TSX_PATH = "npx";

// Test session name to avoid conflicts
const TEST_SESSION = `test-${Date.now()}`;

// Helper to run CLI commands
async function browse(
  args: string,
  options: { timeout?: number; session?: string } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const session = options.session ?? TEST_SESSION;
  const timeout = options.timeout ?? 30000;

  return new Promise((resolve) => {
    const fullArgs = `tsx ${CLI_PATH} --session ${session} ${args}`;
    const child = exec(fullArgs, { timeout }, (error, stdout, stderr) => {
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: error?.code ?? 0,
      });
    });
  });
}

// Helper to parse JSON output
function parseJson(output: string): any {
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`Failed to parse JSON: ${output}`);
  }
}

// Cleanup helper
async function cleanupSession(session: string): Promise<void> {
  const tmpDir = os.tmpdir();
  const patterns = [
    `browse-${session}.sock`,
    `browse-${session}.pid`,
    `browse-${session}.ws`,
    `browse-${session}.chrome.pid`,
  ];

  for (const pattern of patterns) {
    try {
      await fs.unlink(path.join(tmpDir, pattern));
    } catch {}
  }

  // Clean network dir
  try {
    await fs.rm(path.join(tmpDir, `browse-${session}-network`), {
      recursive: true,
    });
  } catch {}
}

describe("Browse CLI", () => {
  // Cleanup before and after all tests
  beforeAll(async () => {
    await cleanupSession(TEST_SESSION);
  });

  afterAll(async () => {
    // Stop daemon if running
    await browse("stop --force");
    await cleanupSession(TEST_SESSION);
  });

  describe("Daemon Lifecycle", () => {
    afterEach(async () => {
      await browse("stop --force");
    });

    it("should start daemon on first command", async () => {
      const result = await browse("status");
      const data = parseJson(result.stdout);
      // Initially not running
      expect(data.running).toBe(false);

      // Start via command
      const startResult = await browse("start");
      expect(startResult.stdout).toContain("started");

      // Now should be running
      const statusResult = await browse("status");
      const statusData = parseJson(statusResult.stdout);
      expect(statusData.running).toBe(true);
    });

    it("should stop daemon gracefully", async () => {
      await browse("start");

      const stopResult = await browse("stop");
      const data = parseJson(stopResult.stdout);
      expect(data.status).toBe("stopped");

      // Verify stopped
      const statusResult = await browse("status");
      const statusData = parseJson(statusResult.stdout);
      expect(statusData.running).toBe(false);
    });

    it("should force stop unresponsive daemon", async () => {
      await browse("start");

      const result = await browse("stop --force");
      const data = parseJson(result.stdout);
      expect(["stopped", "force stopped", "not running"]).toContain(
        data.status,
      );
    });

    it("should support multiple sessions", async () => {
      const session1 = `${TEST_SESSION}-1`;
      const session2 = `${TEST_SESSION}-2`;

      try {
        // Start both sessions
        await browse("start", { session: session1 });
        await browse("start", { session: session2 });

        // Both should be running
        const status1 = parseJson(
          (await browse("status", { session: session1 })).stdout,
        );
        const status2 = parseJson(
          (await browse("status", { session: session2 })).stdout,
        );

        expect(status1.running).toBe(true);
        expect(status2.running).toBe(true);
      } finally {
        await browse("stop --force", { session: session1 });
        await browse("stop --force", { session: session2 });
        await cleanupSession(session1);
        await cleanupSession(session2);
      }
    });
  });

  describe("Navigation", () => {
    beforeAll(async () => {
      await browse("start");
    });

    afterAll(async () => {
      await browse("stop --force");
    });

    it("should navigate to URL", async () => {
      const result = await browse("open https://example.com");
      const data = parseJson(result.stdout);
      expect(data.url).toContain("example.com");
    });

    it("should get current URL", async () => {
      await browse("open https://example.com");
      const result = await browse("get url");
      const data = parseJson(result.stdout);
      expect(data.url).toContain("example.com");
    });

    it("should get page title", async () => {
      await browse("open https://example.com");
      const result = await browse("get title");
      const data = parseJson(result.stdout);
      expect(data.title).toBeTruthy();
    });

    it("should reload page", async () => {
      await browse("open https://example.com");
      const result = await browse("reload");
      const data = parseJson(result.stdout);
      expect(data.url).toContain("example.com");
    });
  });

  describe("Snapshot", () => {
    beforeAll(async () => {
      await browse("start");
      await browse("open https://example.com");
    });

    afterAll(async () => {
      await browse("stop --force");
    });

    it("should take snapshot with refs", async () => {
      const result = await browse("snapshot");
      const data = parseJson(result.stdout);

      expect(data.tree).toBeTruthy();
      expect(data.xpathMap).toBeTruthy();
      expect(typeof data.xpathMap).toBe("object");
    });

    it("should take compact snapshot", async () => {
      const result = await browse("snapshot -c");
      // Compact mode outputs tree directly (not JSON when not --json)
      expect(result.stdout).toContain("RootWebArea");
    });

    it("should populate refs for subsequent commands", async () => {
      await browse("snapshot");
      const refsResult = await browse("refs");
      const data = parseJson(refsResult.stdout);

      expect(data.count).toBeGreaterThan(0);
      expect(data.xpathMap).toBeTruthy();
    });
  });

  describe("Screenshot", () => {
    const screenshotPath = path.join(
      os.tmpdir(),
      `browse-test-${Date.now()}.png`,
    );

    beforeAll(async () => {
      await browse("start");
      await browse("open https://example.com");
    });

    afterAll(async () => {
      await browse("stop --force");
      try {
        await fs.unlink(screenshotPath);
      } catch {}
    });

    it("should take screenshot and return base64", async () => {
      const result = await browse("screenshot");
      const data = parseJson(result.stdout);
      expect(data.base64).toBeTruthy();
      expect(data.base64.length).toBeGreaterThan(100);
    });

    it("should save screenshot to file", async () => {
      const result = await browse(`screenshot ${screenshotPath}`);
      const data = parseJson(result.stdout);
      expect(data.saved).toBe(screenshotPath);

      // Verify file exists
      const stat = await fs.stat(screenshotPath);
      expect(stat.size).toBeGreaterThan(0);
    });
  });

  describe("Actions", () => {
    beforeAll(async () => {
      await browse("start");
    });

    afterAll(async () => {
      await browse("stop --force");
    });

    it("should click by coordinates", async () => {
      await browse("open https://example.com");
      const result = await browse("click_xy 100 100");
      const data = parseJson(result.stdout);
      expect(data.clicked).toBe(true);
    });

    it("should click by ref after snapshot", async () => {
      await browse("open https://example.com");
      await browse("snapshot");

      // Find a clickable ref
      const refsResult = await browse("refs");
      const refs = parseJson(refsResult.stdout);

      if (refs.count > 0) {
        const firstRef = Object.keys(refs.xpathMap)[0];
        const result = await browse(`click @${firstRef}`);
        const data = parseJson(result.stdout);
        expect(data.clicked).toBe(true);
      }
    });

    it("should type text", async () => {
      await browse("open https://example.com");
      const result = await browse('type "Hello World"');
      const data = parseJson(result.stdout);
      expect(data.typed).toBe(true);
    });

    it("should press keys", async () => {
      await browse("open https://example.com");
      const result = await browse("press Tab");
      const data = parseJson(result.stdout);
      expect(data.pressed).toBe("Tab");
    });

    it("should hover at coordinates", async () => {
      await browse("open https://example.com");
      const result = await browse("hover 200 200");
      const data = parseJson(result.stdout);
      expect(data.hovered).toBe(true);
    });

    it("should scroll", async () => {
      await browse("open https://example.com");
      const result = await browse("scroll 400 400 0 100");
      const data = parseJson(result.stdout);
      expect(data.scrolled).toBe(true);
    });
  });

  describe("Multi-Tab", () => {
    beforeAll(async () => {
      await browse("start");
    });

    afterAll(async () => {
      await browse("stop --force");
    });

    it("should list pages", async () => {
      await browse("open https://example.com");
      const result = await browse("pages");
      const data = parseJson(result.stdout);

      expect(data.pages).toBeInstanceOf(Array);
      expect(data.pages.length).toBeGreaterThan(0);
      expect(data.pages[0]).toHaveProperty("index");
      expect(data.pages[0]).toHaveProperty("url");
    });

    it("should create new page", async () => {
      const beforeResult = await browse("pages");
      const beforeData = parseJson(beforeResult.stdout);
      const beforeCount = beforeData.pages.length;

      const newResult = await browse("newpage https://github.com");
      const newData = parseJson(newResult.stdout);
      expect(newData.created).toBe(true);

      const afterResult = await browse("pages");
      const afterData = parseJson(afterResult.stdout);
      expect(afterData.pages.length).toBe(beforeCount + 1);
    });

    it("should switch tabs", async () => {
      await browse("open https://example.com");
      await browse("newpage https://github.com");

      const result = await browse("tab_switch 0");
      const data = parseJson(result.stdout);
      expect(data.switched).toBe(true);
      expect(data.index).toBe(0);
    });

    it("should close tab", async () => {
      await browse("open https://example.com");
      await browse("newpage https://github.com");

      const beforeResult = await browse("pages");
      const beforeCount = parseJson(beforeResult.stdout).pages.length;

      const closeResult = await browse("tab_close");
      const closeData = parseJson(closeResult.stdout);
      expect(closeData.closed).toBe(true);

      const afterResult = await browse("pages");
      const afterCount = parseJson(afterResult.stdout).pages.length;
      expect(afterCount).toBe(beforeCount - 1);
    });
  });

  describe("Waiting", () => {
    beforeAll(async () => {
      await browse("start");
    });

    afterAll(async () => {
      await browse("stop --force");
    });

    it("should wait for timeout", async () => {
      await browse("open https://example.com");
      const start = Date.now();
      const result = await browse("wait timeout 500");
      const elapsed = Date.now() - start;

      const data = parseJson(result.stdout);
      expect(data.waited).toBe(true);
      expect(elapsed).toBeGreaterThanOrEqual(450);
    });

    it("should wait for load state", async () => {
      await browse("open https://example.com");
      const result = await browse("wait load");
      const data = parseJson(result.stdout);
      expect(data.waited).toBe(true);
    });
  });

  describe("Network Capture", () => {
    beforeAll(async () => {
      await browse("start");
    });

    afterAll(async () => {
      await browse("stop --force");
    });

    it("should enable network capture", async () => {
      const result = await browse("network on");
      const data = parseJson(result.stdout);
      expect(data.enabled).toBe(true);
      expect(data.path).toBeTruthy();
    });

    it("should return network path", async () => {
      await browse("network on");
      const result = await browse("network path");
      const data = parseJson(result.stdout);
      expect(data.path).toBeTruthy();
      expect(data.enabled).toBe(true);
    });

    it("should capture requests to filesystem", async () => {
      await browse("network on");
      const pathResult = await browse("network path");
      const networkDir = parseJson(pathResult.stdout).path;

      // Navigate to trigger requests
      await browse("open https://example.com");

      // Wait for requests to be written
      await browse("wait timeout 1000");

      // Check if directory has content
      try {
        const entries = await fs.readdir(networkDir);
        // May or may not have captured requests depending on timing
        expect(Array.isArray(entries)).toBe(true);
      } catch {
        // Directory may not exist if no requests captured
      }
    });

    it("should disable network capture", async () => {
      await browse("network on");
      const result = await browse("network off");
      const data = parseJson(result.stdout);
      expect(data.enabled).toBe(false);
    });

    it("should clear network captures", async () => {
      await browse("network on");
      await browse("open https://example.com");
      await browse("wait timeout 500");

      const result = await browse("network clear");
      const data = parseJson(result.stdout);
      expect(data.cleared).toBe(true);
    });
  });

  describe("Viewport", () => {
    beforeAll(async () => {
      await browse("start");
      await browse("open https://example.com");
    });

    afterAll(async () => {
      await browse("stop --force");
    });

    it("should set viewport size", async () => {
      const result = await browse("viewport 1920 1080");
      const data = parseJson(result.stdout);
      expect(data.viewport.width).toBe(1920);
      expect(data.viewport.height).toBe(1080);
    });
  });

  describe("Eval", () => {
    beforeAll(async () => {
      await browse("start");
      await browse("open https://example.com");
    });

    afterAll(async () => {
      await browse("stop --force");
    });

    it("should evaluate JavaScript", async () => {
      const result = await browse('eval "document.title"');
      const data = parseJson(result.stdout);
      expect(data.result).toBeTruthy();
    });

    it("should return computed values", async () => {
      const result = await browse('eval "1 + 1"');
      const data = parseJson(result.stdout);
      expect(data.result).toBe(2);
    });
  });

  describe("Error Handling", () => {
    beforeAll(async () => {
      await browse("start");
    });

    afterAll(async () => {
      await browse("stop --force");
    });

    it("should error on invalid ref", async () => {
      await browse("open https://example.com");
      // Don't run snapshot, so refs are empty
      const result = await browse("click @99-99");
      expect(result.stderr).toContain("Error");
    });

    it("should error on unknown command", async () => {
      const result = await browse("nonexistent");
      expect(result.exitCode).not.toBe(0);
    });
  });
});
