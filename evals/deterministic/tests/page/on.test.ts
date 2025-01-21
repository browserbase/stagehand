import { expect, test } from "@playwright/test";
import { Stagehand } from "@/dist";
import StagehandConfig from "@/evals/deterministic/stagehand.config";

test.describe("StagehandPage - page.on()", () => {
  test("should click on the crewAI blog tab", async () => {
    const stagehand = new Stagehand(StagehandConfig);
    await stagehand.init();

    const page = stagehand.page;
    await page.goto(
      "https://docs.browserbase.com/integrations/crew-ai/introduction",
    );

    let clickPromise: Promise<void>;

    page.on("popup", async (newPage) => {
      clickPromise = newPage.click(
        "body > div.page-wrapper > div.navbar-2.w-nav > div.padding-global.top-bot > div > div.navigation-left > nav > a:nth-child(7)",
      );
    });

    await page.goto(
      "https://docs.browserbase.com/integrations/crew-ai/introduction",
    );

    await page.click(
      "#content-area > div.relative.mt-8.prose.prose-gray.dark\\:prose-invert > p:nth-child(2) > a",
    );

    await clickPromise;

    await stagehand.close();
  });

  test("should close the new tab and navigate to it on the existing page", async () => {
    const stagehand = new Stagehand(StagehandConfig);
    await stagehand.init();

    const page = stagehand.page;
    await page.goto(
      "https://docs.browserbase.com/integrations/crew-ai/introduction",
    );

    let navigatePromise: Promise<unknown>;

    page.on("popup", async (newPage) => {
      navigatePromise = Promise.allSettled([
        newPage.close(),
        page.goto(newPage.url(), { waitUntil: "domcontentloaded" }),
      ]);
    });

    // Click on the crewAI blog tab
    await page.click(
      "#content-area > div.relative.mt-8.prose.prose-gray.dark\\:prose-invert > p:nth-child(2) > a",
    );

    await navigatePromise;

    await page.click(
      "body > div.page-wrapper > div.navbar-2.w-nav > div.padding-global.top-bot > div > div.navigation-left > nav > a:nth-child(3)",
    );

    await page.waitForLoadState("domcontentloaded");

    const currentUrl = page.url();
    expect(currentUrl).toBe("https://www.crewai.com/open-source");

    await stagehand.close();
  });

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
    await page.goto("https://example.com");

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
    await page.goto("https://example.com");

    const requests: string[] = [];
    const responses: string[] = [];

    page.on("request", (request) => {
      requests.push(request.url());
    });

    page.on("response", (response) => {
      responses.push(response.url());
    });

    await page.goto("https://example.com");

    expect(requests).toContain("https://example.com/");
    expect(responses).toContain("https://example.com/");

    await stagehand.close();
  });
});
