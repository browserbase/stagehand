import assert from "node:assert/strict";
import { test } from "node:test";
import type { Page } from "@browserbasehq/stagehand";
import { Browser } from "../src/browser.js";
import { makeTools } from "../src/scenario.js";
import { initialState, returnControl, type Store } from "../src/state.js";

function fixture() {
  const state = initialState();
  const store: Store = {
    read: async () => structuredClone(state),
    update: async (change) => change(state),
  };
  return { state, store, browser: new Browser(store) };
}

void test("run rejects stale snapshot IDs and persists intent before one login click", async () => {
  const { state, browser } = fixture();
  state.loginStarted = true;
  let url = "https://www.notion.so/login";
  let clicks = 0;
  browser.page = async () =>
    ({
      pageId: "tab-1",
      url: async () => url,
      snapshot: async () => ({
        formattedTree: "[1] Continue with email",
        xpathMap: { "1": "//button" },
        urlMap: {},
      }),
      locator: (selector: string) => ({
        click: async () => {
          assert.equal(selector, "xpath=//button");
          assert.equal(state.loginActionAttempted, true);
          clicks++;
        },
      }),
    }) as unknown as Page;
  await assert.rejects(browser.run("1"), /fresh snapshot/);
  await browser.snapshot();
  url = "https://www.notion.so/login?changed=1";
  await assert.rejects(browser.run("1"), /fresh snapshot/);
  assert.equal(state.loginActionAttempted, false);
  await browser.snapshot();
  await browser.run("1");
  await browser.snapshot();
  await assert.rejects(browser.run("1"), /already attempted/);
  assert.equal(clicks, 1);
});

void test("a work limit hands off without touching the browser; human return grants one new batch", async () => {
  const { state, store, browser } = fixture();
  state.calls = 30;
  let screenshots = 0;
  browser.screenshot = async () => {
    screenshots++;
    return "aW1hZ2U=";
  };
  const screenshot = makeTools(store, browser).find((tool) => tool.name === "screenshot")!;
  await screenshot.execute({}, "limit-tool");
  assert.equal(screenshots, 0);
  assert.equal(state.decision?.status, "pending");
  await assert.rejects(screenshot.execute({}, "blocked"), /Human owns/);
  returnControl(state, state.decision!.id);
  const result = await screenshot.execute({}, "after-return");
  assert.equal(typeof result, "object");
  if (typeof result !== "string")
    assert.deepEqual(result.output, [{ type: "image", data: "aW1hZ2U=", mimeType: "image/png" }]);
  assert.equal(state.calls, 1);
  returnControl(state, state.decision!.id);
  assert.equal(state.calls, 1);
});

void test("workspace completion saves the read-only result after human return", async () => {
  const { state, store, browser } = fixture();
  const workspace = {
    url: "https://www.notion.so/workspace",
    title: "My workspace",
    pages: [{ title: "Project", url: "https://www.notion.so/project" }],
  };
  browser.workspace = async () => workspace;
  const read = makeTools(store, browser).find((tool) => tool.name === "read_workspace")!;
  await read.execute({}, "read-workspace");
  assert.equal(state.confirmed, true);
  assert.deepEqual(state.workspace, workspace);
});
