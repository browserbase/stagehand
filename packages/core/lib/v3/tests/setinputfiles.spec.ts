import { expect, test } from "@playwright/test";
import { V3 } from "../v3";
import { v3TestConfig } from "./v3.config";

test.describe("tests setInputFiles()", () => {
  let v3: V3;

  test.beforeEach(async () => {
    v3 = new V3(v3TestConfig);
    await v3.init();
  });

  test.afterEach(async () => {
    await v3?.close?.().catch(() => {});
  });

  test("deepLocator().setInputFiles() (inside an iframe)", async () => {
    const page = v3.context.pages()[0];
    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/file-uploads-iframe/",
    );
    await page
      .deepLocator("/html/body/div/iframe/html/body/div/div[1]/input")
      .setInputFiles("fake.html");
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const successMessage = await page
      .deepLocator(
        "body > div > iframe >> html > body > div > div:nth-of-type(2)",
      )
      .textContent();
    expect(successMessage).toContain("file uploaded successfully");
  });

  test("locator().setInputFiles() (no iframe)", async () => {
    const page = v3.context.pages()[0];
    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/file-uploads/",
    );
    await page
      .locator("/html/body/div/div[1]/input")
      .setInputFiles("fake.html");
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const successMessage = await page
      .locator("body > div > div:nth-of-type(2)")
      .textContent();
    expect(successMessage).toContain("file uploaded successfully");
  });
});
