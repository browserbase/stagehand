import { createRequire } from "node:module";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Stagehand } from "../../src/index.js";
import { closeStagehand, createStagehand, firstPage } from "./_support.js";

type CdpSession = {
  send(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
  detach(): Promise<void>;
};

type PlaywrightPage = {
  url(): string;
  context(): { newCDPSession(page: PlaywrightPage): Promise<CdpSession> };
};

type PlaywrightBrowser = {
  contexts(): Array<{ pages(): PlaywrightPage[] }>;
  close(): Promise<void>;
};

type Playwright = {
  chromium: { connectOverCDP(url: string): Promise<PlaywrightBrowser> };
};

const requireFromEvals = createRequire(new URL("../../../evals/package.json", import.meta.url));
const { chromium } = requireFromEvals("playwright") as Playwright;

describe("Locator.fill()", () => {
  let stagehand: Stagehand;

  beforeAll(async () => {
    stagehand = await createStagehand();
  });

  afterAll(async () => {
    await closeStagehand(stagehand);
  });

  it("fills date inputs via value setter even when beforeinput blocks insertText", async () => {
    const page = await firstPage(stagehand);
    await page.goto(
      "data:text/html," +
        encodeURIComponent(`<!doctype html><html><body>
          <input id="date" type="date" />
          <script>
            const input = document.getElementById('date');
            input.addEventListener('beforeinput', (event) => {
              if (event && event.inputType === 'insertText') event.preventDefault();
            });
          </script>
        </body></html>`),
    );

    const dateInput = page.locator("xpath=/html/body/input");
    await dateInput.fill("2026-01-01");
    const value = await dateInput.inputValue();
    expect(value).toBe("2026-01-01");
  });

  it("xpath case: throws an error when fill encounters an exception", async () => {
    const page = await firstPage(stagehand);
    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          '<!doctype html><html><body><input id="date" type="date" /></body></html>',
        ),
    );
    await page.waitForSelector("xpath=/html/body/input");
    await poisonLocatorWorld(stagehand, "xpath=/html/body/input");

    const dateInput = page.locator("xpath=/html/body/input");
    let error: unknown;
    try {
      await dateInput.fill("2026-01-01");
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    if (error instanceof Error) {
      expect(error.message).toContain("Error Filling Element");
      expect(error.message).toContain("selector: xpath=/html/body/input");
      expect(error.message).toContain("boom");
    }
  });

  it("css selector case: throws an error when fill encounters an exception", async () => {
    const page = await firstPage(stagehand);
    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          '<!doctype html><html><body><input id="date" type="date" /></body></html>',
        ),
    );
    await page.waitForSelector("#date");
    await poisonLocatorWorld(stagehand, "#date");

    const dateInput = page.locator("#date");
    let error: unknown;
    try {
      await dateInput.fill("2026-01-01");
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    if (error instanceof Error) {
      expect(error.message).toContain("Error Filling Element");
      expect(error.message).toContain("selector: #date");
      expect(error.message).toContain("boom");
    }
  });
});

async function poisonLocatorWorld(stagehand: Stagehand, selector: string): Promise<void> {
  const sdkPage = (await stagehand.browser.context.pages())[0];
  if (!sdkPage) throw new Error("Stagehand did not expose its initial page");

  await sdkPage.locator(selector).count();
  const cdpUrl = stagehand.rpcClient?.browserWebSocketDebuggerUrl;
  if (!cdpUrl) throw new Error("Stagehand did not expose its browser CDP URL");
  const browser = await chromium.connectOverCDP(cdpUrl);
  try {
    const playwrightPage = browser
      .contexts()[0]
      ?.pages()
      .find((candidate) => candidate.url().startsWith("data:"));
    if (!playwrightPage) throw new Error("Playwright could not find the Stagehand data URL page");

    const session = await playwrightPage.context().newCDPSession(playwrightPage);
    try {
      const frameTree = await session.send("Page.getFrameTree");
      const frameId = readFrameId(frameTree);
      const isolatedWorld = await session.send("Page.createIsolatedWorld", {
        frameId,
        worldName: "__stagehand_locator_fallback__",
      });
      const executionContextId = isolatedWorld.executionContextId;
      if (typeof executionContextId !== "number") {
        throw new Error("CDP did not return an isolated-world execution context");
      }

      await session.send("Runtime.evaluate", {
        expression: `(() => {
          const input = document.querySelector('input');
          Object.defineProperty(input, 'isConnected', {
            get() { throw new Error('boom'); },
            configurable: true
          });
        })()`,
        contextId: executionContextId,
      });
    } finally {
      await session.detach();
    }
  } finally {
    await browser.close();
  }
}

function readFrameId(frameTree: Record<string, unknown>): string {
  const tree = frameTree.frameTree;
  if (!tree || typeof tree !== "object") throw new Error("CDP did not return a frame tree");
  const frame = (tree as Record<string, unknown>).frame;
  if (!frame || typeof frame !== "object") throw new Error("CDP did not return a root frame");
  const id = (frame as Record<string, unknown>).id;
  if (typeof id !== "string") throw new Error("CDP did not return a root frame ID");
  return id;
}
