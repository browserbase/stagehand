import { test, expect } from "@playwright/test";
import { V3 } from "../../lib/v3/v3.js";
import { getV3TestConfig } from "./v3.config.js";

const isBrowserbase =
  (process.env.STAGEHAND_BROWSER_TARGET ?? "local").toLowerCase() ===
  "browserbase";

test.describe("Agent captcha auto-solve on Browserbase", () => {
  test.skip(!isBrowserbase, "Requires Browserbase environment");

  let v3: V3;

  test.beforeEach(async () => {
    v3 = new V3(
      getV3TestConfig({
        env: "BROWSERBASE",
        // solveCaptchas defaults to true on Browserbase
      }),
    );
    await v3.init();
  });

  test.afterEach(async () => {
    await v3?.close?.().catch(() => {});
  });

  test("agent completes a reCAPTCHA v2 demo without conflicting with the solver", async () => {
    test.setTimeout(120_000);

    const page = v3.context.pages()[0];
    await page.goto("https://2captcha.com/demo/recaptcha-v2", {
      waitUntil: "load",
    });

    const agent = v3.agent({
      mode: "dom",
      model: "anthropic/claude-haiku-4-5-20251001",
    });

    const result = await agent.execute({
      instruction:
        'Solve the captcha on this page and click the "Check" button. ' +
        "Wait for the result and report whether the verification succeeded.",
      maxSteps: 15,
    });

    // The agent should finish and report success (Browserbase solves the captcha)
    expect(result.completed).toBe(true);
    expect(result.message.toLowerCase()).toContain("success");
  });
});
