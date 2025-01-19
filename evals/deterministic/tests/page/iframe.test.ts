import { test } from "@playwright/test";
import { Stagehand } from "../../../../lib";
import StagehandConfig from "../../stagehand.config";
import { safeLocatorWithIframeSupport } from "../../../../lib/utils";

test.describe("StagehandPage - iframe support", () => {
  test("should be able to click on the support button in iframe", async () => {
    const stagehand = new Stagehand({
      ...StagehandConfig,
      unsafeIframeSupport: true,
    });
    await stagehand.init();

    const page = stagehand.page;

    await page.goto("https://softdrive.co");

    const element = safeLocatorWithIframeSupport(page, [
      "//div[6]/iframe",
      "//body/div[2]/div[1]/div/span[2]/div/div/button",
    ]).first();
    console.log("[Element]", element);

    await element.click();

    await stagehand.close();
  });
});
