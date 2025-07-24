import { expect, test } from "@playwright/test";
import { Stagehand } from "@browserbasehq/stagehand";
import StagehandConfig from "@/evals/deterministic/stagehand.config";

test.describe("StagehandPage - page.on()", () => {
  test("should handle console events", async () => {
    const stagehand = new Stagehand(StagehandConfig);
    await stagehand.init();

    const page = stagehand.page;
    await page.goto("https://example.com");

    const messages: string[] = [];
    page.on("console", (msg) => {
      messages.push(msg.text());
    });

    await page.evaluate(() => console.log("Test console log"));

    expect(messages).toContain("Test console log");

    await stagehand.close();
  });

  test("should handle dialog events", async () => {
    const stagehand = new Stagehand(StagehandConfig);
    await stagehand.init();

    const page = stagehand.page;
    await page.goto("https://example.com", { waitUntil: "commit" });

    page.on("dialog", async (dialog) => {
      expect(dialog.message()).toBe("Test alert");
      await dialog.dismiss();
    });

    await page.evaluate(() => alert("Test alert"));

    await stagehand.close();
  });

  test("should handle request and response events", async () => {
    const stagehand = new Stagehand(StagehandConfig);
    await stagehand.init();

    const page = stagehand.page;
    await page.goto("https://example.com", { waitUntil: "commit" });

    const requests: string[] = [];
    const responses: string[] = [];

    page.on("request", (request) => {
      requests.push(request.url());
    });

    page.on("response", (response) => {
      responses.push(response.url());
    });

    await page.goto("https://example.com", { waitUntil: "commit" });

    expect(requests).toContain("https://example.com/");
    expect(responses).toContain("https://example.com/");

    await stagehand.close();
  });
});
