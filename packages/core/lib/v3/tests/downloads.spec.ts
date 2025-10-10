import { test, expect } from "@playwright/test";
import { V3 } from "../v3";
import Browserbase from "@browserbasehq/sdk";
import AdmZip from "adm-zip";
import { v3BBTestConfig } from "./v3.bb.config";

const pdfRe = /sample-(\d{13})+\.pdf/;
test.describe("downloads on browserbase", () => {
  let v3: V3;

  test.beforeEach(async () => {
    v3 = new V3(v3BBTestConfig);
    await v3.init();
  });

  test.afterEach(async () => {
    await v3?.close?.().catch(() => {});
  });

  test("downloaded pdf is available via downloads api", async () => {
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
