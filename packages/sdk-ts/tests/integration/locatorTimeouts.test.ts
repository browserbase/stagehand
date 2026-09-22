import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Stagehand, Page } from "../../src/index.js";
import {
  closeStagehand,
  createStagehand,
  firstPage,
  startFixtureServer,
  type FixtureServer,
} from "./_support.js";

// Delays are per frame: nested cases prove the timeout isn't reset at each hop.
describe("public locator timeouts", () => {
  let stagehand: Stagehand;
  let page: Page;
  let server: FixtureServer;
  let clicks = 0;
  beforeAll(async () => {
    server = await startFixtureServer(async (request) => {
      const url = new URL(request.url!, "http://fixture");
      if (url.pathname === "/clicked") {
        clicks++;
        return "ok";
      }
      const depth = Number(url.searchParams.get("depth") ?? 0);
      const delay = Number(url.searchParams.get("delay") ?? 0);
      if (depth) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        if (depth > 1) return `<iframe src="/child?depth=${depth - 1}&delay=${delay}"></iframe>`;
        return `<button onclick="fetch('/clicked')">click</button>`;
      }
      return `<button>ready</button><input><div hidden id="hidden"></div>`;
    });
    stagehand = await createStagehand();
    page = await firstPage(stagehand);
  });
  afterAll(async () => {
    await closeStagehand(stagehand);
    await server?.close();
  });

  async function prepare(delay: number, depth = 1) {
    clicks = 0;
    await page.goto(server.url);
    await page.evaluate(
      ({ delay, depth }) => {
        const frame = document.createElement("iframe");
        frame.src = `/child?depth=${depth}&delay=${delay}`;
        document.body.append(frame);
      },
      { delay, depth },
    );
    return `${"iframe >> ".repeat(depth)}button`;
  }

  it.each([
    { name: "explicit override", delay: 1800, depth: 1, timeout: 4000 },
    { name: "default", delay: 1800, depth: 1, timeout: undefined },
    { name: "disabled", delay: 5500, depth: 1, timeout: 0 },
  ])("click succeeds with $name", async ({ delay, depth, timeout }) => {
    const selector = await prepare(delay, depth);
    await page.locator(selector).click(timeout === undefined ? undefined : { timeout });
    await expect.poll(() => clicks).toBe(1);
  });

  it.each([
    { name: "short override", delay: 900, depth: 1, timeout: 250 },
    { name: "default", delay: 6000, depth: 1, timeout: undefined },
    { name: "shared nested deadline", delay: 1800, depth: 2, timeout: 2800 },
    { name: "shared nested default", delay: 2800, depth: 2, timeout: undefined },
  ])("$name expires without a late click", async ({ delay, depth, timeout }) => {
    const selector = await prepare(delay, depth);
    const start = Date.now();
    await expect(
      page.locator(selector).click(timeout === undefined ? undefined : { timeout }),
    ).rejects.toThrow(`${timeout ?? 5000}ms`);
    expect(Date.now() - start).toBeLessThan((timeout ?? 5000) + 1200);
    await page.waitForSelector(selector, { timeout: 8000 });
    await page.waitForTimeout(250);
    expect(clicks).toBe(0);
  });

  it("preserves selector-wait and act deadlines", async () => {
    const selector = await prepare(1800);
    await expect(page.waitForSelector(selector, { timeout: 250 })).rejects.toThrow("250ms");
    await expect(
      stagehand.act(
        { selector, method: "click", arguments: [], description: "click child" },
        { timeout: 250 },
      ),
    ).rejects.toThrow("250ms");
    await page.waitForSelector(selector, { timeout: 4000 });
    await page.waitForTimeout(250);
    expect(clicks).toBe(0);
  });

  it("ready calls and current-state queries return promptly", async () => {
    await page.goto(server.url);
    const start = Date.now();
    await page.locator("button").click();
    expect(await page.locator("#missing").count({ timeout: 4000 })).toBe(0);
    expect(await page.locator("#hidden").isVisible({ timeout: 4000 })).toBe(false);
    // Preserve existing missing-element behavior; this PR doesn't add auto-waiting.
    await expect(page.locator("#missing").isVisible({ timeout: 4000 })).rejects.toThrow();
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it("typing delays and highlight duration consume the operation timeout", async () => {
    await page.goto(server.url);
    await expect(page.locator("input").type("abcd", { delay: 300, timeout: 250 })).rejects.toThrow(
      "250ms",
    );
    const value = await page.locator("input").inputValue();
    await page.waitForTimeout(1200);
    expect(await page.locator("input").inputValue()).toBe(value);
    await page.locator("input").fill("");
    await page.locator("input").type("ab", { delay: 150, timeout: 2000 });
    expect(await page.locator("input").inputValue()).toBe("ab");
    await expect(
      page.locator("button").highlight({ durationMs: 800, timeout: 250 }),
    ).rejects.toThrow("250ms");
    await page.locator("button").highlight({ durationMs: 300, timeout: 2000 });
  });
});
