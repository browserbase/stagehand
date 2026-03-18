import { test, expect } from "@playwright/test";
import { V3 } from "../../lib/v3/v3.js";
import { getV3TestConfig } from "./v3.config.js";
import type { LogLine } from "../../lib/v3/types/public/logs.js";

const isBrowserbase =
  (process.env.STAGEHAND_BROWSER_TARGET ?? "local").toLowerCase() ===
  "browserbase";

test.describe("Agent captcha auto-solve on Browserbase", () => {
  test.skip(!isBrowserbase, "Requires Browserbase environment");

  let v3: V3;
  let logs: LogLine[];

  test.beforeEach(async () => {
    logs = [];
    v3 = new V3(
      getV3TestConfig({
        env: "BROWSERBASE",
        verbose: 2,
        logger: (line: LogLine) => {
          logs.push(line);
          console.log(`[${line.category}] ${line.message}`);
        },
        browserbaseSessionCreateParams: {
          browserSettings: {
            solveCaptchas: true,
          },
        },
      }),
    );
    await v3.init();
    console.log("BB session URL:", v3.browserbaseSessionURL);
  });

  test.afterEach(async () => {
    await v3?.close?.().catch(() => {});
  });

  test("reCAPTCHA v2 auto-solve (Google demo)", async () => {
    test.setTimeout(180_000);
    const page = v3.context.pages()[0];
    // Google's official reCAPTCHA v2 demo — same URL the stealth team tests.
    // Use domcontentloaded since BB's route interception can delay full load.
    await page.goto("https://www.google.com/recaptcha/api2/demo", {
      waitUntil: "domcontentloaded",
    });

    // Give BB time to intercept the anchor request and solve the captcha
    await new Promise((r) => setTimeout(r, 30_000));

    const agent = v3.agent({
      mode: "dom",
      model: "anthropic/claude-haiku-4-5-20251001",
    });

    const result = await agent.execute({
      instruction:
        'Click the "Submit" button and report the exact text shown on the result page.',
      maxSteps: 15,
    });

    console.log("reCAPTCHA v2 result:", result.message);

    expect(result.completed).toBe(true);
    expect(result.message.toLowerCase()).toContain("success");
  });
});
