import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Stagehand } from "../../src/index.js";
import { closeStagehand, createStagehand, firstPage } from "./_support.js";

describe("Locator.setInputFiles()", () => {
  let stagehand: Stagehand;

  beforeAll(async () => {
    stagehand = await createStagehand();
  });

  afterAll(async () => {
    await closeStagehand(stagehand);
  });

  it("uploads a local file and clears the selection", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "stagehand-upload-test-"));
    const filePath = path.join(directory, "hello.txt");
    await writeFile(filePath, "hello from the integration test");
    try {
      const page = await firstPage(stagehand);
      await page.goto(`data:text/html,${encodeURIComponent('<input id="upload" type="file">')}`);
      const input = page.locator("#upload");

      await input.setInputFiles(filePath);
      await expect(
        page.evaluate(`(async () => {
          const file = document.querySelector('#upload').files[0];
          return file ? { name: file.name, text: await file.text() } : null;
        })()`),
      ).resolves.toStrictEqual({ name: "hello.txt", text: "hello from the integration test" });

      await input.setInputFiles([]);
      await expect(page.evaluate(`document.querySelector('#upload').files.length`)).resolves.toBe(
        0,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
