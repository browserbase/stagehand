import { test, expect } from "@playwright/test";
import { Stagehand } from "@browserbasehq/stagehand";
import StagehandConfig from "@/evals/deterministic/stagehand.config";

test.describe("StagehandPage - page.context()", () => {
  let stagehand: Stagehand;

  test.beforeEach(async () => {
    stagehand = new Stagehand(StagehandConfig);
    await stagehand.init();
  });

  test.afterEach(async () => {
    if (stagehand) {
      try {
        await stagehand.close();
      } catch (error) {
        console.error("[afterEach] Error during stagehand.close():", error);
      }
    } else {
      console.log("[afterEach] Stagehand was not defined, skipping close().");
    }
  });

  test("should confirm page.context() and stagehand.context share state", async () => {
    const page = stagehand.page;
    const stagehandContext = stagehand.context;
    const pageContext = page.context();

    await pageContext.addCookies([
      {
        name: "stagehandTestCookie",
        value: "hello-stagehand",
        domain: "browserbase.github.io",
        path: "/",
        expires: Math.floor(Date.now() / 1000) + 3600, // 1 hour
        httpOnly: false,
        secure: false,
        sameSite: "Lax",
      },
    ]);

    const cookies = await stagehandContext.cookies(
      "https://browserbase.github.io/stagehand-eval-sites/sites/example/",
    );

    const testCookie = cookies.find((c) => c.name === "stagehandTestCookie");
    expect(testCookie).toBeDefined();
    expect(testCookie?.value).toBe("hello-stagehand");

    const extraPage = await pageContext.newPage();
    await extraPage.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/example",
      { waitUntil: "networkidle" },
    );
    const contextPages = stagehandContext.pages();

    // The newly created page should be recognized by stagehandContext as well.
    const foundExtraPage = contextPages.find(
      (p) =>
        p.url() ===
        "https://browserbase.github.io/stagehand-eval-sites/sites/example/",
    );
    expect(foundExtraPage).toBeDefined();
  });
});
