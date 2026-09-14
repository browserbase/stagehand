import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Stagehand } from "../../src/index.js";
import { closeStagehand, createStagehand } from "./_support.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("userDataDir persistence", () => {
  let stagehand: Stagehand;
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "stagehand-userdata-test-"));
  });

  afterEach(async () => {
    await closeStagehand(stagehand);
    if (testDir && fs.existsSync(testDir)) {
      fs.rmSync(testDir, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    }
  });

  it("Chrome uses the specified userDataDir", async () => {
    stagehand = await createStagehand({
      browser: { userDataDir: testDir, preserveUserDataDir: true },
    });

    await expect
      .poll(
        () =>
          fs.existsSync(path.join(testDir, "Default")) &&
          fs.existsSync(path.join(testDir, "Local State")),
        { timeout: 10_000 },
      )
      .toBe(true);
  });
});
