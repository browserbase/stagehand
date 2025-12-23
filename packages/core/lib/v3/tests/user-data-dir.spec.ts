import { test, expect } from "@playwright/test";
import { V3 } from "../v3";
import { v3TestConfig } from "./v3.config";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function removeDirWithRetries(dir: string, retries = 10, delayMs = 500) {
  let lastError: NodeJS.ErrnoException | undefined;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      const isBusy = code === "EBUSY" || code === "EPERM";
      if (!isBusy) {
        throw err;
      }
      lastError = err as NodeJS.ErrnoException;
      const hasMoreRetries = attempt < retries - 1;
      if (hasMoreRetries) {
        await sleep(delayMs);
        continue;
      }
      break;
    }
  }

  if (lastError) {
    console.warn(
      `Failed to delete temp userDataDir after ${retries} attempts: ${lastError.message}`,
    );
  }
}

test.describe("userDataDir persistence", () => {
  let v3: V3;
  let testDir: string;

  test.beforeEach(() => {
    testDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "stagehand-userdata-test-"),
    );
  });

  test.afterEach(async () => {
    await v3?.close?.().catch(() => {});
    if (testDir && fs.existsSync(testDir)) {
      await removeDirWithRetries(testDir);
    }
  });

  test("Chrome uses the specified userDataDir", async () => {
    v3 = new V3({
      ...v3TestConfig,
      localBrowserLaunchOptions: {
        ...v3TestConfig.localBrowserLaunchOptions,
        userDataDir: testDir,
        preserveUserDataDir: true,
      },
    });

    await v3.init();

    const page = v3.context.pages()[0];
    await page.goto("about:blank");

    await expect
      .poll(() => fs.existsSync(path.join(testDir, "Default")), {
        timeout: 10_000,
      })
      .toBe(true);

    expect(fs.existsSync(path.join(testDir, "Local State"))).toBe(true);
  });
});
