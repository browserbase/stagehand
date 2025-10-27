import { test, expect } from "@playwright/test";
import { V3 } from "../v3";
import Browserbase from "@browserbasehq/sdk";
import AdmZip from "adm-zip";
import { v3DynamicTestConfig } from "./v3.dynamic.config";

const pdfRe = /sample-(\d{13})+\.pdf/;
test.describe("downloads on browserbase", () => {
  let v3: V3;

  test.beforeEach(async () => {
    v3 = new V3(v3DynamicTestConfig);
    await v3.init();
  });

  test.afterEach(async () => {
    await v3?.close?.().catch(() => {});
  });

  test("downloaded pdf is available via downloads api", async () => {
    // Skip this test in LOCAL mode as it requires Browserbase session
    test.skip(
      process.env.TEST_ENV === "LOCAL" || !process.env.TEST_ENV,
      "Skipping Browserbase-only downloads test in LOCAL mode",
    );

    // Skip if BROWSERBASE_API_KEY is not set
    test.skip(
      !process.env.BROWSERBASE_API_KEY,
      "Skipping test: BROWSERBASE_API_KEY not set",
    );

    // Tiny timeout to force the race to hit the timeout branch
    const page = v3.context.pages()[0];
    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/download-on-click/",
    );
    await page.locator("/html/body/button").click();

    await expect(async () => {
      const bb = new Browserbase();
      const zipBuffer = await bb.sessions.downloads.list(
        v3.browserbaseSessionId,
      );
      if (!zipBuffer) {
        throw new Error(
          `Download buffer is empty for session ${v3.browserbaseSessionId}`,
        );
      }

      const zip = new AdmZip(Buffer.from(await zipBuffer.arrayBuffer()));
      const zipEntries = zip.getEntries();
      const pdfEntry = zipEntries.find((entry) => pdfRe.test(entry.entryName));

      if (!pdfEntry) {
        throw new Error(
          `Session ${v3.browserbaseSessionId} is missing a file matching "${pdfRe.toString()}" in its zip entries: ${JSON.stringify(zipEntries.map((entry) => entry.entryName))}`,
        );
      }

      const expectedFileSize = 13264;
      expect(pdfEntry.header.size).toBe(expectedFileSize);
    }).toPass({
      timeout: 30_000,
    });
  });
});
