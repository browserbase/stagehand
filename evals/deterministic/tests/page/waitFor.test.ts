import { test, expect } from "@playwright/test";
import { Stagehand } from "@browserbasehq/stagehand";
import StagehandConfig from "@/evals/deterministic/stagehand.config";

test.describe("StagehandPage - waitFor", () => {
  test("should wait for an element to become visible", async () => {
    const stagehand = new Stagehand(StagehandConfig);
    await stagehand.init();

    const page = stagehand.page;
    await page.goto("https://docs.browserbase.com/introduction");
    const dynamicElement = page.locator(
      "div.grid:nth-child(1) > a:nth-child(1) > div:nth-child(1)",
    );

    const isVisibleBefore = await dynamicElement.isVisible();
    expect(isVisibleBefore).toBe(false);

    const clickableElement = page.locator(
      "div.not-prose:nth-child(2) > a:nth-child(1) > div:nth-child(1)",
    );
    await clickableElement.click();

    await dynamicElement.waitFor({ state: "visible" });

    const isVisibleAfter = await dynamicElement.isVisible();
    expect(isVisibleAfter).toBe(true);

    await stagehand.close();
  });

  test("should wait for an element to be detached", async () => {
    const stagehand = new Stagehand(StagehandConfig);
    await stagehand.init();

    const page = stagehand.page;
    await page.goto("https://docs.browserbase.com/introduction");

    const disappearingElement = page.locator(
      "div.not-prose:nth-child(2) > a:nth-child(1) > div:nth-child(1)",
    );

    await disappearingElement.click();
    await disappearingElement.waitFor({ state: "detached" });

    const isAttachedAfter = await disappearingElement.isVisible();
    expect(isAttachedAfter).toBe(false);

    await stagehand.close();
  });

  test("should wait for a specific event (waitForEvent)", async () => {
    const stagehand = new Stagehand(StagehandConfig);
    await stagehand.init();

    const page = stagehand.page;
    await page.goto("https://docs.browserbase.com/introduction");

    const consolePromise = page.waitForEvent("console");
    await page.evaluate(() => {
      console.log("Hello from the browser console!");
    });
    const consoleMessage = await consolePromise;
    expect(consoleMessage.text()).toBe("Hello from the browser console!");

    await stagehand.close();
  });

  test("should wait for a function to return true (waitForFunction)", async () => {
    const stagehand = new Stagehand(StagehandConfig);
    await stagehand.init();

    const page = stagehand.page;
    await page.goto("https://docs.browserbase.com/introduction");

    await page.evaluate(() => {
      setTimeout(() => {
        const w = window as typeof window & {
          __stagehandFlag?: boolean;
        };
        w.__stagehandFlag = true;
      }, 1000);
    });

    await page.waitForFunction(() => {
      const w = window as typeof window & {
        __stagehandFlag?: boolean;
      };
      return w.__stagehandFlag === true;
    });

    const value = await page.evaluate(() => {
      const w = window as typeof window & {
        __stagehandFlag?: boolean;
      };
      return w.__stagehandFlag;
    });
    expect(value).toBe(true);

    await stagehand.close();
  });

  test("should wait for the load state (waitForLoadState)", async () => {
    const stagehand = new Stagehand(StagehandConfig);
    await stagehand.init();

    const page = stagehand.page;
    await page.goto("https://docs.browserbase.com/introduction");
    await page.waitForLoadState("networkidle");
    const heroTitle = page.locator("h1");
    await expect(heroTitle).toHaveText(/Documentation/i);

    await stagehand.close();
  });

  test("should wait for a specific request (waitForRequest)", async () => {
    const stagehand = new Stagehand(StagehandConfig);
    await stagehand.init();

    const page = stagehand.page;
    const requestPromise = page.waitForRequest((req) =>
      req.url().includes("mintlify"),
    );

    await page.goto("https://docs.browserbase.com/introduction");
    const matchingRequest = await requestPromise;
    expect(matchingRequest.url()).toContain("mintlify");

    await stagehand.close();
  });

  test("should wait for a specific response (waitForResponse)", async () => {
    const stagehand = new Stagehand(StagehandConfig);
    await stagehand.init();

    const page = stagehand.page;
    const responsePromise = page.waitForResponse(
      (res) => res.url().includes("introduction") && res.status() === 200,
    );

    await page.goto("https://docs.browserbase.com/introduction");
    const matchingResponse = await responsePromise;
    expect(await matchingResponse.text()).toContain("Browserbase");

    await stagehand.close();
  });

  test("should wait for a URL (waitForURL)", async () => {
    const stagehand = new Stagehand(StagehandConfig);
    await stagehand.init();

    const page = stagehand.page;
    await page.goto("https://docs.browserbase.com");

    const getStartedLink = page.locator(
      "div.not-prose:nth-child(3) > a:nth-child(1) > div:nth-child(1)",
    );
    await getStartedLink.click();

    await page.waitForURL(/.*getting-started.*/);
    expect(page.url()).toContain("/getting-started");

    await stagehand.close();
  });
});
