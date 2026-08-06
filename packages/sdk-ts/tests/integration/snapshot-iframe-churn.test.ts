import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Stagehand } from "../../src/index.js";
import {
  closeStagehand,
  createStagehand,
  firstPage,
  startFixtureServer,
  type FixtureServer,
} from "./_support.js";

const frameCount = 24;
const frameNodeCount = 16;
const replacementsPerTick = 4;
const churnIntervalMs = 20;
const churnTicks = 100;

describe("page.snapshot() survives bounded iframe churn", () => {
  let fixtureServer: FixtureServer;
  let stagehand: Stagehand;

  beforeAll(async () => {
    fixtureServer = await startFixtureServer((request) => {
      const url = new URL(request.url ?? "/", "http://fixture.invalid");
      if (url.pathname === "/frame") {
        const generation = url.searchParams.get("generation") ?? "0";
        return `<!doctype html>
<html>
  <body>
    <p>generation ${generation}</p>
    ${Array.from(
      { length: frameNodeCount },
      (_, index) => `<button type="button">volatile action ${index}</button>`,
    ).join("\n")}
  </body>
</html>`;
      }
      if (url.pathname !== "/") return { status: 404, body: "not found" };
      return fixtureHtml();
    });
    stagehand = await createStagehand();
  });

  afterAll(async () => {
    await closeStagehand(stagehand);
    await fixtureServer.close();
  });

  it("keeps complete snapshots and the browser connection usable", async () => {
    const page = await firstPage(stagehand);
    await page.goto(fixtureServer.url, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('#frames[data-ready="true"]', {
      state: "attached",
      timeout: 15_000,
    });

    const control = await page.snapshot({ includeIframes: false });
    expect(control.formattedTree).toContain("Synthetic iframe churn fixture");

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(page.evaluate("window.snapshotFixture.startChurn()")).resolves.toBe("started");
      const duringChurn = await page.snapshot();
      expect(countMatches(duringChurn.formattedTree, /Synthetic iframe churn fixture/g)).toBe(1);
      expect(duringChurn.formattedTree).toContain("volatile action");
      await page.waitForSelector('#frames[data-churning="false"]', {
        state: "attached",
        timeout: 10_000,
      });
    }

    const settled = await page.snapshot();
    expect(countMatches(settled.formattedTree, /Synthetic iframe churn fixture/g)).toBe(1);
    for (let index = 0; index < frameNodeCount; index += 1) {
      expect(
        countMatches(settled.formattedTree, new RegExp(`volatile action ${index}\\b`, "g")),
      ).toBe(frameCount);
    }
    await expect(page.evaluate("document.title")).resolves.toBe("Snapshot Churn Fixture");
    await expect(stagehand.metrics()).resolves.toBeDefined();
  }, 45_000);
});

function countMatches(value: string, pattern: RegExp): number {
  return value.match(pattern)?.length ?? 0;
}

function fixtureHtml(): string {
  return `<!doctype html>
<html>
  <head>
    <title>Snapshot Churn Fixture</title>
  </head>
  <body>
    <h1>Synthetic iframe churn fixture</h1>
    <div id="frames" data-ready="false" data-churning="false"></div>
    <script>
      const frameCount = ${frameCount};
      const replacementsPerTick = ${replacementsPerTick};
      const churnIntervalMs = ${churnIntervalMs};
      const churnTicks = ${churnTicks};
      const frames = document.querySelector("#frames");
      const initialLoads = new Set();
      let generation = 0;
      let churnTimer;

      function makeFrame(slot, frameGeneration) {
        const frame = document.createElement("iframe");
        frame.dataset.slot = String(slot);
        frame.src = "/frame?slot=" + slot + "&generation=" + frameGeneration;
        if (frameGeneration === 0) {
          frame.addEventListener("load", () => {
            initialLoads.add(slot);
            if (initialLoads.size === frameCount) frames.dataset.ready = "true";
          }, { once: true });
        }
        return frame;
      }

      function stopChurn() {
        if (churnTimer !== undefined) clearInterval(churnTimer);
        churnTimer = undefined;
        frames.dataset.churning = "false";
      }

      function startChurn() {
        if (churnTimer !== undefined) return "already-running";
        let completedTicks = 0;
        frames.dataset.churning = "true";
        churnTimer = setInterval(() => {
          generation += 1;
          completedTicks += 1;
          for (let offset = 0; offset < replacementsPerTick; offset += 1) {
            const slot = (generation * replacementsPerTick + offset) % frameCount;
            const current = frames.querySelector('iframe[data-slot="' + slot + '"]');
            current?.replaceWith(makeFrame(slot, generation));
          }
          if (completedTicks >= churnTicks) stopChurn();
        }, churnIntervalMs);
        return "started";
      }

      for (let slot = 0; slot < frameCount; slot += 1) {
        frames.append(makeFrame(slot, 0));
      }

      window.snapshotFixture = { startChurn };
    </script>
  </body>
</html>`;
}
