import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { localBrowser, Stagehand, type StagehandBrowser } from "../../src/index.js";

type FixtureServer = {
  url: string;
  close(): Promise<void>;
};

const frameCount = readPositiveInt("SNAPSHOT_CHURN_FRAME_COUNT", 48);
const frameNodeCount = readPositiveInt("SNAPSHOT_CHURN_NODE_COUNT", 40);
const replacementsPerTick = readPositiveInt("SNAPSHOT_CHURN_REPLACEMENTS", 8);
const churnIntervalMs = readPositiveInt("SNAPSHOT_CHURN_INTERVAL_MS", 16);
const snapshotAttempts = readPositiveInt("SNAPSHOT_CHURN_ATTEMPTS", 4);

describe("Stagehand snapshot iframe-churn smoke", () => {
  let fixtureServer: FixtureServer | undefined;
  let stagehand: Stagehand | undefined;
  let browser: StagehandBrowser | undefined;

  beforeAll(async () => {
    fixtureServer = await startFixtureServer();
    browser = await localBrowser.launch({ headless: true });
    stagehand = await Stagehand.create({ browser });
  }, 45_000);

  afterAll(async () => {
    try {
      await stagehand?.close();
    } finally {
      await browser?.close().catch(() => {});
      await fixtureServer?.close();
    }
  }, 30_000);

  it("keeps the browser usable while volatile iframes detach during snapshots", async () => {
    if (!stagehand || !fixtureServer) throw new Error("Snapshot smoke was not initialized");

    const page =
      (await stagehand.browser.context.pages())[0] ?? (await stagehand.browser.context.newPage());
    await page.goto(fixtureServer.url, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#fixture-ready", { state: "attached", timeout: 10_000 });

    const control = await page.snapshot({ includeIframes: false });
    expect(control.formattedTree).toContain("Synthetic iframe churn fixture");

    const outcomes: Array<{ ok: boolean; durationMs: number; error?: string }> = [];
    for (let attempt = 0; attempt < snapshotAttempts; attempt += 1) {
      const startedAt = Date.now();
      try {
        const snapshot = await page.snapshot();
        outcomes.push({ ok: true, durationMs: Date.now() - startedAt });
        expect(snapshot.formattedTree).toContain("Synthetic iframe churn fixture");
      } catch (error) {
        outcomes.push({
          ok: false,
          durationMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      await expect(page.evaluate("document.title")).resolves.toBe("Snapshot Churn Fixture");
    }

    expect(
      outcomes.every((outcome) => outcome.ok),
      JSON.stringify(outcomes),
    ).toBe(true);
    await expect(stagehand.metrics()).resolves.toBeDefined();
  }, 70_000);
});

async function startFixtureServer(): Promise<FixtureServer> {
  const server = createServer((request, response) => {
    if (request.url?.startsWith("/frame")) {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html>
<html>
  <body>
    <main>
      ${Array.from(
        { length: frameNodeCount },
        (_, index) => `<button type="button">volatile action ${index}</button>`,
      ).join("\n")}
    </main>
  </body>
</html>`);
      return;
    }

    if (request.url !== "/") {
      response.writeHead(404);
      response.end("not found");
      return;
    }

    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html>
<html>
  <head>
    <title>Snapshot Churn Fixture</title>
  </head>
  <body>
    <h1>Synthetic iframe churn fixture</h1>
    <p id="fixture-ready">ready</p>
    <div id="frames"></div>
    <script>
      const frameCount = ${frameCount};
      const replacementsPerTick = ${replacementsPerTick};
      const churnIntervalMs = ${churnIntervalMs};
      const frames = document.querySelector("#frames");
      let generation = 0;

      function makeFrame(slot) {
        const frame = document.createElement("iframe");
        frame.dataset.slot = String(slot);
        frame.src = "/frame?slot=" + slot + "&generation=" + generation;
        return frame;
      }

      for (let slot = 0; slot < frameCount; slot += 1) {
        frames.append(makeFrame(slot));
      }

      setInterval(() => {
        generation += 1;
        for (let offset = 0; offset < replacementsPerTick; offset += 1) {
          const slot = (generation * replacementsPerTick + offset) % frameCount;
          const current = frames.querySelector('iframe[data-slot="' + slot + '"]');
          current?.replaceWith(makeFrame(slot));
        }
      }, churnIntervalMs);
    </script>
  </body>
</html>`);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Snapshot fixture server did not bind to a TCP port");
  }

  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () => closeServer(server),
  };
}

function readPositiveInt(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
