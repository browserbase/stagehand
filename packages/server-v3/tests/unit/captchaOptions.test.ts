import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { V3 } from "@browserbasehq/stagehand";

import { InMemorySessionStore } from "../../src/lib/InMemorySessionStore.js";

describe("session store CAPTCHA options", () => {
  for (const browserType of ["local", "browserbase"] as const) {
    for (const options of [
      { wait: true, solve: false, expected: false },
      { wait: undefined, solve: true, expected: true },
      { wait: false, solve: true, expected: false },
      { wait: true, solve: undefined, expected: true },
      { wait: undefined, solve: false, expected: false },
      {
        wait: undefined,
        solve: undefined,
        expected: browserType === "browserbase",
      },
    ]) {
      it(`${browserType}: wait=${options.wait}, solve=${options.solve}`, async (context) => {
        context.mock.method(V3.prototype, "init", async () => {});
        const store = new InMemorySessionStore();
        try {
          const { sessionId } = await store.startSession({
            browserType,
            modelName: "openai/gpt-4.1-mini",
            waitForCaptchaSolves: options.wait,
            browserbaseSessionCreateParams: {
              browserSettings: { solveCaptchas: options.solve },
            },
            localBrowserLaunchOptions: { cdpUrl: "ws://attached-browser" },
          });
          const stagehand = await store.getOrCreateStagehand(sessionId, {});
          assert.equal(stagehand.isCaptchaAutoSolveEnabled, options.expected);
        } finally {
          await store.destroy();
        }
      });
    }
  }
});
