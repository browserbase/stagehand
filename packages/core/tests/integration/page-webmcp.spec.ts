import { test, expect } from "@playwright/test";
import { V3 } from "../../lib/v3/v3.js";
import { v3DynamicTestConfig } from "./v3.dynamic.config.js";
import { closeV3 } from "./testUtils.js";

const WEBMCP_TEST_SITE =
  "https://browserbase.github.io/stagehand-eval-sites/sites/webmcp-test/";

test.describe("Page WebMCP e2e", () => {
  let v3: V3 | null = null;

  test.beforeEach(async () => {
    const browserTarget = (
      process.env.STAGEHAND_BROWSER_TARGET ?? "local"
    ).toLowerCase();
    const isBrowserbase = browserTarget === "browserbase";
    test.skip(!isBrowserbase, "Requires STAGEHAND_BROWSER_TARGET=browserbase");
    test.skip(
      !process.env.BROWSERBASE_API_KEY || !process.env.BROWSERBASE_PROJECT_ID,
      "BROWSERBASE credentials are required",
    );

    v3 = new V3(v3DynamicTestConfig);
    await v3.init();
  });

  test.afterEach(async () => {
    await closeV3(v3);
  });

  test("lists and invokes tools registered by the page", async () => {
    const page = v3!.context.pages()[0];
    await page.goto(WEBMCP_TEST_SITE, { waitUntil: "load" });

    const tools = await page.listWebMCPTools({ timeoutMs: 5_000 });
    const toolNames = tools.map((tool) => tool.name);

    expect(toolNames).toEqual(
      expect.arrayContaining([
        "searchFlights",
        "calculateSum",
        "failWithMessage",
        "submitSupportRequest",
      ]),
    );

    const calculateSum = tools.find((tool) => tool.name === "calculateSum");
    expect(calculateSum).toBeDefined();

    const invocation = await page.invokeWebMCPTool(
      "calculateSum",
      { a: 19, b: 23 },
      { frameId: calculateSum!.frameId, timeoutMs: 5_000 },
    );
    const result = await invocation.result;

    expect(result).toMatchObject({
      invocationId: invocation.invocationId,
      status: "Completed",
      output: { a: 19, b: 23, sum: 42 },
    });

    await expect
      .poll(() => page.mainFrame().locator("#last-tool").textContent())
      .toBe("calculateSum");
    await expect
      .poll(() => page.mainFrame().locator("#invocation-count").textContent())
      .toBe("1");
  });
});
