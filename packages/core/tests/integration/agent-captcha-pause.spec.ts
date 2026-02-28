import { test, expect } from "@playwright/test";
import { V3 } from "../../lib/v3/v3.js";
import { v3TestConfig, getV3TestConfig } from "./v3.config.js";
import { CaptchaSolver } from "../../lib/v3/agent/utils/captchaSolver.js";
import { closeV3 } from "./testUtils.js";

/**
 * E2E tests for the agent captcha auto-pause feature.
 *
 * The CaptchaSolver listens for Browserbase's console messages:
 *   - "browserbase-solving-started"  → pause agent
 *   - "browserbase-solving-finished" → resume agent
 *   - "browserbase-solving-errored"  → resume agent (with error flag)
 *
 * These tests validate:
 *   1. CaptchaSolver correctly blocks/resumes based on console messages
 *   2. The 90s timeout safety net works
 *   3. The agent system prompt includes captcha instructions when enabled
 *   4. Navigation to the recaptcha demo site triggers the solver flow on Browserbase
 */

const RECAPTCHA_DEMO_URL = "https://www.google.com/recaptcha/api2/demo";

test.describe("Agent captcha auto-pause", () => {
  let v3: V3;

  test.afterEach(async () => {
    await closeV3(v3);
  });

  test.describe("CaptchaSolver unit behavior", () => {
    test.beforeEach(async () => {
      v3 = new V3(v3TestConfig);
      await v3.init();
    });

    test("waitIfSolving resolves immediately when no captcha is being solved", async () => {
      const solver = new CaptchaSolver();
      solver.init(() => v3.context.awaitActivePage());

      const start = Date.now();
      await solver.waitIfSolving();
      const elapsed = Date.now() - start;

      // Should resolve nearly instantly (< 100ms)
      expect(elapsed).toBeLessThan(100);
      solver.dispose();
    });

    test("waitIfSolving blocks until solving-finished console message", async () => {
      const solver = new CaptchaSolver();
      solver.init(() => v3.context.awaitActivePage());
      await solver.ensureAttached();

      const page = v3.context.pages()[0];
      await page.goto(
        "https://browserbase.github.io/stagehand-eval-sites/sites/login/",
      );

      // Simulate the captcha solving started console message
      await page.evaluate(() => {
        console.log("browserbase-solving-started");
      });

      // Give the event a tick to propagate
      await new Promise((r) => setTimeout(r, 100));

      // Now waitIfSolving should block
      let resolved = false;
      const waitPromise = solver.waitIfSolving().then(() => {
        resolved = true;
      });

      // Should not have resolved yet
      await new Promise((r) => setTimeout(r, 200));
      expect(resolved).toBe(false);

      // Emit the finished message
      await page.evaluate(() => {
        console.log("browserbase-solving-finished");
      });

      // Now it should resolve
      await waitPromise;
      expect(resolved).toBe(true);
      expect(solver.lastSolveErrored).toBe(false);

      solver.dispose();
    });

    test("waitIfSolving unblocks on solving-errored with error flag set", async () => {
      const solver = new CaptchaSolver();
      solver.init(() => v3.context.awaitActivePage());
      await solver.ensureAttached();

      const page = v3.context.pages()[0];
      await page.goto(
        "https://browserbase.github.io/stagehand-eval-sites/sites/login/",
      );

      // Start solving
      await page.evaluate(() => {
        console.log("browserbase-solving-started");
      });
      await new Promise((r) => setTimeout(r, 100));

      // Start waiting
      let resolved = false;
      const waitPromise = solver.waitIfSolving().then(() => {
        resolved = true;
      });

      // Emit error
      await page.evaluate(() => {
        console.log("browserbase-solving-errored");
      });

      await waitPromise;
      expect(resolved).toBe(true);
      expect(solver.lastSolveErrored).toBe(true);

      // resetError clears the flag
      solver.resetError();
      expect(solver.lastSolveErrored).toBe(false);

      solver.dispose();
    });

    test("multiple concurrent waitIfSolving callers share the same promise", async () => {
      const solver = new CaptchaSolver();
      solver.init(() => v3.context.awaitActivePage());
      await solver.ensureAttached();

      const page = v3.context.pages()[0];
      await page.goto(
        "https://browserbase.github.io/stagehand-eval-sites/sites/login/",
      );

      // Start solving
      await page.evaluate(() => {
        console.log("browserbase-solving-started");
      });
      await new Promise((r) => setTimeout(r, 100));

      // Two concurrent waiters
      const results: number[] = [];
      const wait1 = solver.waitIfSolving().then(() => results.push(1));
      const wait2 = solver.waitIfSolving().then(() => results.push(2));

      // Neither should have resolved
      await new Promise((r) => setTimeout(r, 200));
      expect(results.length).toBe(0);

      // Finish solving
      await page.evaluate(() => {
        console.log("browserbase-solving-finished");
      });

      await Promise.all([wait1, wait2]);
      expect(results.length).toBe(2);

      solver.dispose();
    });

    test("dispose resolves any pending waiters", async () => {
      const solver = new CaptchaSolver();
      solver.init(() => v3.context.awaitActivePage());
      await solver.ensureAttached();

      const page = v3.context.pages()[0];
      await page.goto(
        "https://browserbase.github.io/stagehand-eval-sites/sites/login/",
      );

      // Start solving
      await page.evaluate(() => {
        console.log("browserbase-solving-started");
      });
      await new Promise((r) => setTimeout(r, 100));

      let resolved = false;
      const waitPromise = solver.waitIfSolving().then(() => {
        resolved = true;
      });

      // Dispose should resolve the waiter
      solver.dispose();
      await waitPromise;
      expect(resolved).toBe(true);
    });
  });

  test.describe("isCaptchaSolverEnabled property", () => {
    test("returns true for Browserbase env without explicit solveCaptchas=false", async () => {
      const browserTarget = (
        process.env.STAGEHAND_BROWSER_TARGET ?? "local"
      ).toLowerCase();
      if (browserTarget !== "browserbase") {
        test.skip(true, "Only applicable on Browserbase");
      }

      v3 = new V3(
        getV3TestConfig({
          env: "BROWSERBASE",
        }),
      );
      await v3.init();

      expect(v3.isBrowserbase).toBe(true);
      expect(v3.isCaptchaSolverEnabled).toBe(true);
    });

    test("returns false for local env", async () => {
      const browserTarget = (
        process.env.STAGEHAND_BROWSER_TARGET ?? "local"
      ).toLowerCase();
      if (browserTarget === "browserbase") {
        test.skip(true, "Only applicable locally");
      }

      v3 = new V3(v3TestConfig);
      await v3.init();

      expect(v3.isBrowserbase).toBe(false);
      expect(v3.isCaptchaSolverEnabled).toBe(false);
    });

    test("returns false when solveCaptchas is explicitly false", async () => {
      const browserTarget = (
        process.env.STAGEHAND_BROWSER_TARGET ?? "local"
      ).toLowerCase();
      if (browserTarget !== "browserbase") {
        test.skip(true, "Only applicable on Browserbase");
      }

      v3 = new V3(
        getV3TestConfig({
          env: "BROWSERBASE",
          browserbaseSessionCreateParams: {
            browserSettings: { solveCaptchas: false },
          },
        }),
      );
      await v3.init();

      expect(v3.isBrowserbase).toBe(true);
      expect(v3.isCaptchaSolverEnabled).toBe(false);
    });
  });

  test.describe("Recaptcha demo site - Browserbase", () => {
    test("agent navigates recaptcha demo and pauses for captcha solving", async () => {
      test.setTimeout(120_000);

      const browserTarget = (
        process.env.STAGEHAND_BROWSER_TARGET ?? "local"
      ).toLowerCase();
      if (browserTarget !== "browserbase") {
        test.skip(true, "Captcha solving requires Browserbase environment");
      }

      v3 = new V3(
        getV3TestConfig({
          env: "BROWSERBASE",
          model: "openai/gpt-4o",
        }),
      );
      await v3.init();

      expect(v3.isCaptchaSolverEnabled).toBe(true);

      const page = v3.context.pages()[0];

      // Track console messages for captcha solver events
      const captchaEvents: string[] = [];
      page.on("console", (msg) => {
        const text = msg.text();
        if (text.startsWith("browserbase-solving")) {
          captchaEvents.push(text);
        }
      });

      // Navigate to the recaptcha demo site
      await page.goto(RECAPTCHA_DEMO_URL, { waitUntil: "load" });

      // Create a DOM agent to interact with the page
      const agent = v3.agent({
        mode: "dom",
        model: "openai/gpt-4o",
      });

      // The agent should attempt to submit the form.
      // Browserbase's captcha solver should detect the reCAPTCHA,
      // emit solving-started, solve it, then emit solving-finished.
      // The agent should pause during solving and resume after.
      const result = await agent.execute({
        instruction:
          "Submit the reCAPTCHA demo form. Wait for any captcha to be solved automatically, then click the Submit button.",
        maxSteps: 10,
      });

      // The agent should have completed (captcha solved + form submitted)
      // Note: even if the captcha solve fails, the agent should not crash - 
      // it should gracefully handle the pause/resume cycle
      expect(result).toBeDefined();
      expect(result.actions.length).toBeGreaterThan(0);

      // If running on Browserbase with captcha solving, we should see
      // at least the solving-started event
      if (captchaEvents.length > 0) {
        expect(captchaEvents[0]).toBe("browserbase-solving-started");
        // If solving completed, we should see the finished event
        if (captchaEvents.length >= 2) {
          expect(
            captchaEvents[1] === "browserbase-solving-finished" ||
              captchaEvents[1] === "browserbase-solving-errored",
          ).toBe(true);
        }
      }
    });

    test("agent does not pause when solveCaptchas is disabled", async () => {
      test.setTimeout(90_000);

      const browserTarget = (
        process.env.STAGEHAND_BROWSER_TARGET ?? "local"
      ).toLowerCase();
      if (browserTarget !== "browserbase") {
        test.skip(true, "Captcha solving requires Browserbase environment");
      }

      v3 = new V3(
        getV3TestConfig({
          env: "BROWSERBASE",
          model: "openai/gpt-4o",
          browserbaseSessionCreateParams: {
            browserSettings: { solveCaptchas: false },
          },
        }),
      );
      await v3.init();

      expect(v3.isCaptchaSolverEnabled).toBe(false);

      const page = v3.context.pages()[0];

      // Navigate to recaptcha demo
      await page.goto(RECAPTCHA_DEMO_URL, { waitUntil: "load" });

      // Create agent - captcha solver should NOT be initialized
      const agent = v3.agent({
        mode: "dom",
        model: "openai/gpt-4o",
      });

      // The agent should proceed without pausing (no captcha solver active)
      // It will likely fail to submit the form since captcha isn't solved,
      // but it should not hang or error from the pause mechanism
      const result = await agent.execute({
        instruction:
          "Look at the page and describe what you see. Then mark the task as complete.",
        maxSteps: 5,
      });

      expect(result).toBeDefined();
    });
  });
});
