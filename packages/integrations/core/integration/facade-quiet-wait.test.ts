import assert from "node:assert/strict";
import { afterAll, beforeAll, describe, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { runCallback, type RunEnvelope, type RunInput } from "../src/facade/batch-sources.js";

// page.waitForTimeout with quietWait against a real page, through the run
// prelude a host sends. Native Playwright stands in for the extension's page.
let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({
    ...(process.env.CHROME_PATH
      ? { executablePath: process.env.CHROME_PATH }
      : { channel: process.env.PLAYWRIGHT_CHROMIUM_CHANNEL ?? "chrome" }),
    headless: true,
  });
});
afterAll(async () => {
  await browser?.close();
});

/** A page that changes its DOM every 50 ms for `mutateMs` (Infinity: forever). */
const mutatingPage = (mutateMs: number) => `<output id="tick">0</output><script>
  const started = performance.now();
  const timer = setInterval(() => {
    if (performance.now() - started > ${mutateMs}) {
      clearInterval(timer);
      document.body.dataset.done = "1";
      return;
    }
    document.getElementById("tick").textContent++;
  }, 50);
</script>`;

const TIMED_WAIT = (ms: number) => `const startedAt = Date.now();
await page.waitForTimeout(${ms});
return { waited: Date.now() - startedAt, done: await page.evaluate("document.body.dataset.done ?? null") };`;

async function run(page: Page, code: string, input: RunInput) {
  const envelope = (await (runCallback(code) as unknown as (...args: unknown[]) => unknown)(
    { page, context: { pages: async () => [page], activePage: async () => page } },
    input,
  )) as RunEnvelope;
  assert.equal(envelope.executionError, undefined);
  return {
    value: envelope.value as { waited: number; done: string | null },
    waits: envelope.telemetry.waits,
  };
}

describe("facade page.waitForTimeout with quietWait", () => {
  it("returns once the page stops changing", async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(mutatingPage(1_200));
      const { value, waits } = await run(page, TIMED_WAIT(8_000), { quietWait: true });
      // It waited until the mutations stopped, not the full 8 s.
      assert.equal(value.done, "1");
      assert.ok(value.waited >= 400 && value.waited < 4_000, `waited ${value.waited} ms`);
      assert.equal(waits.count, 1);
      assert.equal(waits.requestedMs, 8_000);
      assert.equal(waits.earlyReturns, 1);
      assert.ok(waits.waitedMs <= value.waited, `waitedMs ${waits.waitedMs}`);
    } finally {
      await page.close();
    }
  });

  it("returns after the window on a page that is already quiet", async () => {
    const page = await browser.newPage();
    try {
      await page.setContent("<p>static</p>");
      const { value, waits } = await run(page, TIMED_WAIT(5_000), { quietWait: true });
      assert.ok(value.waited >= 400 && value.waited < 1_500, `waited ${value.waited} ms`);
      assert.equal(waits.earlyReturns, 1);
    } finally {
      await page.close();
    }
  });

  it("waits for a later change on a document an earlier wait already watched", async () => {
    const page = await browser.newPage();
    try {
      await page.setContent("<p>static</p>");
      await run(page, TIMED_WAIT(2_000), { quietWait: true });
      // The next run's action changes the page 300 ms later (a fetch rendering),
      // inside the quiet window of a wait that starts now.
      const render = `setTimeout(() => { document.body.dataset.done = "1"; }, 300);`;
      const { value, waits } = await run(
        page,
        `await page.evaluate(${JSON.stringify(render)});\n${TIMED_WAIT(5_000)}`,
        { quietWait: true },
      );
      assert.equal(value.done, "1");
      assert.ok(value.waited >= 700 && value.waited < 2_500, `waited ${value.waited} ms`);
      assert.equal(waits.earlyReturns, 1);
      // Both waits removed their observers and keys.
      assert.deepEqual(
        await page.evaluate(() =>
          Object.getOwnPropertyNames(document).filter((name) => name.startsWith("_")),
        ),
        [],
      );
    } finally {
      await page.close();
    }
  });

  it("is capped while the page keeps changing", async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(mutatingPage(Infinity));
      const { value, waits } = await run(page, TIMED_WAIT(1_500), { quietWait: true });
      assert.equal(value.done, null);
      assert.ok(value.waited >= 1_500 && value.waited < 2_500, `waited ${value.waited} ms`);
      assert.deepEqual(waits, { count: 1, requestedMs: 1_500, waitedMs: 1_500, earlyReturns: 0 });
    } finally {
      await page.close();
    }
  });

  it("sleeps the full time when the option is off", async () => {
    const page = await browser.newPage();
    try {
      await page.setContent("<p>static</p>");
      const { value, waits } = await run(page, TIMED_WAIT(1_000), {});
      assert.ok(value.waited >= 1_000, `waited ${value.waited} ms`);
      assert.deepEqual(waits, { count: 1, requestedMs: 1_000, waitedMs: 1_000, earlyReturns: 0 });
    } finally {
      await page.close();
    }
  });

  it("survives a navigation during the wait", async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(mutatingPage(Infinity));
      const navigate = `setTimeout(() => { location.href = "about:blank?next"; }, 300);`;
      const { value, waits } = await run(
        page,
        `await page.evaluate(${JSON.stringify(navigate)});\n${TIMED_WAIT(6_000)}`,
        { quietWait: true },
      );
      assert.ok(value.waited < 4_000, `waited ${value.waited} ms`);
      assert.equal(waits.earlyReturns, 1);
      assert.equal(page.url(), "about:blank?next");
    } finally {
      await page.close();
    }
  });
});
