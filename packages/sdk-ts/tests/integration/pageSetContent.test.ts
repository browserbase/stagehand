import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Stagehand } from "../../src/index.js";
import {
  closeStagehand,
  createStagehand,
  firstPage,
  startFixtureServer,
  type FixtureServer,
} from "./_support.js";

describe("Page.setContent", () => {
  let stagehand: Stagehand;
  let server: FixtureServer;
  let requested: ReturnType<typeof Promise.withResolvers<void>>;
  let release: ReturnType<typeof Promise.withResolvers<void>>;

  beforeEach(async () => {
    requested = Promise.withResolvers<void>();
    release = Promise.withResolvers<void>();
    server = await startFixtureServer({
      "/": "<!doctype html><title>Original</title><h1>Original</h1>",
      "/slow.svg": async () => {
        requested.resolve();
        await release.promise;
        return {
          headers: { "content-type": "image/svg+xml" },
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
        };
      },
    });
    stagehand = await createStagehand();
  });

  afterEach(async () => {
    release.resolve();
    await closeStagehand(stagehand);
    await server.close();
  });

  it("replaces the document, executes scripts, and preserves the URL", async () => {
    const page = await firstPage(stagehand);
    await page.goto(server.url);
    const url = await page.url();

    await page.setContent(
      '<!doctype html><title>Updated</title><h1>雪</h1><script>document.body.dataset.ready="yes"</script>',
    );
    expect(await page.title()).toBe("Updated");
    expect(await page.url()).toBe(url);
    expect(await page.evaluate(() => document.body.dataset.ready)).toBe("yes");
    expect(await page.locator("h1").textContent()).toBe("雪");

    await page.setContent("", { waitUntil: "networkidle", timeout: 0 });
    expect(await page.evaluate(() => document.body.innerHTML)).toBe("");
  });

  it.each(["load", "networkidle"] as const)(
    "waits for the replacement document's %s state, not the old one",
    async (waitUntil) => {
      const page = await firstPage(stagehand);
      await page.goto(server.url, { waitUntil: "load" });
      let completed = false;
      const replacement = page
        .setContent('<h1>Pending image</h1><img src="/slow.svg">', { waitUntil })
        .then(() => {
          completed = true;
        });

      await requested.promise;
      expect(await page.evaluate(() => document.images[0]?.complete)).toBe(false);
      expect(completed).toBe(false);
      release.resolve();
      await replacement;
      expect(await page.evaluate(() => document.images[0]?.complete)).toBe(true);
    },
  );

  it("can finish at DOMContentLoaded while subresources are pending", async () => {
    const page = await firstPage(stagehand);
    await page.goto(server.url);

    await page.setContent('<img src="/slow.svg">', { waitUntil: "domcontentloaded" });
    await requested.promise;
    expect(await page.evaluate(() => document.images[0]?.complete)).toBe(false);
  });

  it("reports a lifecycle timeout and permits a subsequent replacement", async () => {
    const page = await firstPage(stagehand);
    await page.goto(server.url);

    const replacement = page.setContent('<img src="/slow.svg">', { timeout: 1_000 });
    const rejected = expect(replacement).rejects.toThrow(/while waiting for document content/);
    await requested.promise;
    await rejected;
    release.resolve();
    await page.setContent("<h1>Recovered</h1>");
    expect(await page.locator("h1").textContent()).toBe("Recovered");
  });

  it("rejects a timeout-free wait when the page closes", async () => {
    const page = await firstPage(stagehand);
    await page.goto(server.url);
    const replacement = page.setContent('<img src="/slow.svg">', { timeout: 0 });
    const rejected = expect(replacement).rejects.toThrow(/closed|detached/i);

    await requested.promise;
    await page.close();
    await rejected;
  });
});
