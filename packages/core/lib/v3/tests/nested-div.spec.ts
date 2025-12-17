import { test, expect } from "@playwright/test";
import { V3 } from "../v3";
import { captureHybridSnapshot } from "../understudy/a11y/snapshot";
import { v3TestConfig } from "./v3.config";

test.describe("tests captureHybridSnapshot() does not break due to -32000 Failed to convert response to JSON: CBOR: stack limit exceeded", () => {
  let v3: V3;

  test.beforeEach(async () => {
    v3 = new V3(v3TestConfig);
    await v3.init();
  });

  test.afterEach(async () => {
    await v3?.close?.().catch(() => {});
  });

  test("captureHybridSnapshot does not throw", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/nested-div/",
    );

    await expect(captureHybridSnapshot(page)).resolves.toBeDefined();
  });
});
