import { join } from "node:path";
import { test, expect } from "@playwright/test";
import { Stagehand } from "@browserbasehq/stagehand";
import StagehandConfig from "@/evals/deterministic/stagehand.config";

test.describe("Playwright Upload", () => {
  let stagehand: Stagehand;

  test.beforeAll(async () => {
    stagehand = new Stagehand({
      ...StagehandConfig,
      env: "BROWSERBASE",
      useAPI: false,
    });
    await stagehand.init();
  });

  test.afterAll(async () => {
    await stagehand.close();
  });

  test("uploads a file", async () => {
    const page = stagehand.page;
    await page.goto("https://browser-tests-alpha.vercel.app/api/upload-test");

    const fileInput = page.locator("#fileUpload");
    await fileInput.setInputFiles(
      join(__dirname, "../..", "auxiliary", "logo.png"),
    );

    const fileNameSpan = page.locator("#fileName");
    const fileName = await fileNameSpan.innerText();

    const fileSizeSpan = page.locator("#fileSize");
    const fileSize = Number(await fileSizeSpan.innerText());

    expect(fileName).toBe("logo.png");
    expect(fileSize).toBeGreaterThan(0);
  });
});
