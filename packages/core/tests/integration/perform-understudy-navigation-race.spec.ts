import { expect, test } from "@playwright/test";
import { V3 } from "../../lib/v3/v3.js";
import { performUnderstudyMethod } from "../../lib/v3/handlers/handlerUtils/actHandlerUtils.js";
import { closeV3 } from "./testUtils.js";
import { v3DynamicTestConfig } from "./v3.dynamic.config.js";

async function loadDelayedDocumentNavigationFixture(
  v3: V3,
  delayMs: number,
): Promise<{
  page: ReturnType<V3["context"]["pages"]>[number];
  sourceUrl: string;
  targetUrl: string;
}> {
  const page = v3.context.pages()[0];
  const sourceUrl = "https://example.com/";
  const targetUrl = `https://example.com/?nav-race=${delayMs}`;

  await page.goto(sourceUrl, { waitUntil: "load" });

  await page.mainFrame().evaluate(
    ({ delay, nextUrl }) => {
      document.open();
      document.write(`<!DOCTYPE html>
        <html>
          <body>
            <button id="go" type="button">Go</button>
          </body>
        </html>`);
      document.close();

      (window as typeof window & { __navScheduled?: boolean }).__navScheduled =
        false;
      document.getElementById("go")?.addEventListener("click", () => {
        (
          window as typeof window & { __navScheduled?: boolean }
        ).__navScheduled = true;
        setTimeout(() => {
          window.location.assign(nextUrl);
        }, delay);
      });
    },
    { delay: delayMs, nextUrl: targetUrl },
  );

  return {
    page,
    sourceUrl,
    targetUrl,
  };
}

test.describe("performUnderstudyMethod navigation race", () => {
  let v3: V3;

  test.beforeEach(async () => {
    v3 = new V3(v3DynamicTestConfig);
    await v3.init();
  });

  test.afterEach(async () => {
    await closeV3(v3);
  });

  test("waits for navigation that starts within 400ms of click", async () => {
    const { page, targetUrl } = await loadDelayedDocumentNavigationFixture(
      v3,
      250,
    );

    await performUnderstudyMethod(
      page,
      page.mainFrame(),
      "click",
      "xpath=/html/body/button",
      [],
      3_000,
    );

    expect(page.url()).toBe(targetUrl);
  });

  test("does not wait for navigation that starts after 400ms of click", async () => {
    const { page, sourceUrl, targetUrl } =
      await loadDelayedDocumentNavigationFixture(v3, 900);

    await performUnderstudyMethod(
      page,
      page.mainFrame(),
      "click",
      "xpath=/html/body/button",
      [],
      3_000,
    );

    expect(page.url()).toBe(sourceUrl);
    expect(
      await page.evaluate(() => {
        return (window as typeof window & { __navScheduled?: boolean })
          .__navScheduled;
      }),
    ).toBe(true);

    await expect
      .poll(() => page.url(), {
        timeout: 3_000,
      })
      .toBe(targetUrl);
  });
});
