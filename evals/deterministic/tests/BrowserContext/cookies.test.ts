import { test, expect } from "@playwright/test";
import { Stagehand } from "@browserbasehq/stagehand";
import StagehandConfig from "@/evals/deterministic/stagehand.config";

test.describe("StagehandContext - Cookies", () => {
  let stagehand: Stagehand;

  test.beforeEach(async () => {
    stagehand = new Stagehand(StagehandConfig);
    await stagehand.init();
  });

  test.afterEach(async () => {
    await stagehand.close();
  });

  test("should add cookies and retrieve them", async () => {
    const context = stagehand.context; // This is the wrapped BrowserContext
    const url =
      "https://browserbase.github.io/stagehand-eval-sites/sites/example";

    await context.addCookies([
      {
        name: "myCookie",
        value: "myValue",
        domain: "browserbase.github.io",
        path: "/",
        expires: Math.floor(Date.now() / 1000) + 3600,
        httpOnly: false,
        secure: false,
        sameSite: "Lax",
      },
    ]);

    const cookies = await context.cookies(url);
    expect(cookies.length).toBeGreaterThan(0);

    const myCookie = cookies.find((c) => c.name === "myCookie");
    expect(myCookie).toBeDefined();
    expect(myCookie?.value).toBe("myValue");
  });

  test("should clear all cookies", async () => {
    const context = stagehand.context;
    const url =
      "https://browserbase.github.io/stagehand-eval-sites/sites/example";

    await context.addCookies([
      {
        name: "myOtherCookie",
        value: "anotherValue",
        domain: "browserbase.github.io",
        path: "/",
        expires: Math.floor(Date.now() / 1000) + 3600,
        httpOnly: false,
        secure: false,
        sameSite: "Lax",
      },
    ]);

    const cookiesBefore = await context.cookies(url);
    const found = cookiesBefore.some((c) => c.name === "myOtherCookie");
    expect(found).toBe(true);

    await context.clearCookies();

    const cookiesAfter = await context.cookies(url);
    const stillFound = cookiesAfter.some((c) => c.name === "myOtherCookie");
    expect(stillFound).toBe(false);
  });
});
