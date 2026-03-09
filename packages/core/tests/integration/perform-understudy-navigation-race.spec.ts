import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";
import { V3 } from "../../lib/v3/v3.js";
import { performUnderstudyMethod } from "../../lib/v3/handlers/handlerUtils/actHandlerUtils.js";
import { closeV3 } from "./testUtils.js";
import { v3DynamicTestConfig } from "./v3.dynamic.config.js";

async function writeDelayedNavigationFixture(
  outputDir: string,
  delayMs: number,
): Promise<{ sourceUrl: string; targetUrl: string }> {
  const targetPath = path.join(outputDir, `target-${delayMs}.html`);
  const sourcePath = path.join(outputDir, `source-${delayMs}.html`);
  const targetUrl = pathToFileURL(targetPath).href;
  const sourceUrl = pathToFileURL(sourcePath).href;

  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(
    targetPath,
    "<!DOCTYPE html><html><body><h1 id='done'>destination</h1></body></html>",
    "utf8",
  );
  await fs.writeFile(
    sourcePath,
    `<!DOCTYPE html>
      <html>
        <body>
          <button id="go" type="button">Go</button>
          <script>
            window.__navDelayMs = ${delayMs};
            window.__navScheduled = false;
            document.getElementById("go").addEventListener("click", () => {
              window.__navScheduled = true;
              setTimeout(() => {
                window.location.assign(${JSON.stringify(targetUrl)});
              }, ${delayMs});
            });
          </script>
        </body>
      </html>`,
    "utf8",
  );

  // Use file-backed pages so the navigation behaves like a normal document
  // load, while the delay stays fully deterministic inside the fixture.
  return { sourceUrl, targetUrl };
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

  test("waits for navigation that starts within 400ms of click", async ({
    browserName,
  }, testInfo) => {
    void browserName;
    const page = v3.context.pages()[0];
    const { sourceUrl, targetUrl } = await writeDelayedNavigationFixture(
      testInfo.outputDir,
      250,
    );

    await page.goto(sourceUrl, { waitUntil: "load" });

    await performUnderstudyMethod(
      page,
      page.mainFrame(),
      "click",
      "xpath=//*[@id='go']",
      [],
      3_000,
    );

    expect(page.url()).toBe(targetUrl);
  });

  test("does not wait for navigation that starts after 400ms of click", async ({
    browserName,
  }, testInfo) => {
    void browserName;
    const page = v3.context.pages()[0];
    const { sourceUrl, targetUrl } = await writeDelayedNavigationFixture(
      testInfo.outputDir,
      900,
    );

    await page.goto(sourceUrl, { waitUntil: "load" });

    await performUnderstudyMethod(
      page,
      page.mainFrame(),
      "click",
      "xpath=//*[@id='go']",
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
