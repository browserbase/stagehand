import assert from "node:assert/strict";
import { test } from "node:test";
import { Browser } from "../src/browser.js";
import { initialState } from "../src/state.js";

void test("pause retains the remote browser; cleanup releases it even when detach fails", async () => {
  const state = initialState();
  state.browser = { sessionId: "saved-session", expiresAt: Date.now() + 60_000 };
  const browser = new Browser({
    read: async () => state,
    update: async (change) => change(state),
  });
  const releases: string[] = [];
  Object.defineProperty(browser, "bb", {
    value: {
      sessions: {
        update: async (id: string, options: { status: string }) => {
          assert.equal(options.status, "REQUEST_RELEASE");
          releases.push(id);
        },
      },
    },
  });
  Object.assign(browser, { stagehand: { close: async () => {} } });
  await browser.stop();
  assert.deepEqual(releases, []);

  Object.assign(browser, {
    stagehand: {
      close: async () => {
        throw new Error("Detach failed");
      },
    },
  });
  await assert.rejects(browser.stop(true), /Detach failed/);
  assert.deepEqual(releases, ["saved-session"]);
});
