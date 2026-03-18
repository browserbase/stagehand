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
        logger: (line: LogLine) => logs.push(line),
        browserbaseSessionCreateParams: {
          browserSettings: {
            solveCaptchas: true,
          },
        },
      }),
    );
    await v3.init();
  });

  test.afterEach(async () => {
    await v3?.close?.().catch(() => {});
  });

  test("agent auto-pauses while Browserbase solves a captcha and does not race with the solver", async () => {
    test.setTimeout(180_000);

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
        "Look at this page and try to submit the form by clicking the Check button. " +
        "Report what happened after clicking.",
      maxSteps: 20,
    });

    // The agent should complete without crashing
    expect(result.completed).toBe(true);

    // The captcha auto-pause mechanism should have fired — BB emits
    // browserbase-solving-started on pages with detectable captchas.
    // Verify the agent was paused (either solved or errored notification).
    const captchaLogFired = logs.some(
      (line) =>
        line.message.includes("waiting for Browserbase to solve") ||
        line.message.includes("Captcha solved") ||
        line.message.includes("Captcha solver failed"),
    );
    expect(captchaLogFired).toBe(true);

    // The agent should NOT have used act/click on the captcha checkbox itself.
    // It may mention "captcha" in reasoning (describing the page) but should
    // not have an action whose description targets the reCAPTCHA checkbox.
    const agentClickedCaptchaCheckbox = result.actions?.some(
      (a) =>
        a.type === "act" &&
        typeof a.description === "string" &&
        /I'm not a robot|recaptcha checkbox/i.test(a.description),
    );
    expect(agentClickedCaptchaCheckbox).toBeFalsy();
  });
});
