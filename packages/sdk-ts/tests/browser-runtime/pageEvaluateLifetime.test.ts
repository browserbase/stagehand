import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { localBrowser, Stagehand } from "../../src/index.js";
import { launchLocalBrowser } from "../../src/browser/localBrowser.js";
import { CdpConnection, type CDPSessionLike } from "../../../extension/understudy/cdp.js";
import { browserWebSocketFactory } from "../../../extension/understudy/browserWebSocketTransport.js";
import { executionContexts } from "../../../extension/understudy/executionContextRegistry.js";
import { Frame } from "../../../extension/understudy/frame.js";
import type { StagehandLogger } from "../../../extension/logger.js";

// A WeakMap keeps the resolver alive exactly as long as the promise is retained.
// Resolve it through the retained objectId after forcing garbage collection.
const controllablePromise = `(() => {
  globalThis.__resolvers = new WeakMap();
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  globalThis.__resolvers.set(promise, resolve);
  return promise;
})()`;
const resolvePromise = "function() { globalThis.__resolvers.get(this)(42); }";
const logger = { debug() {}, error() {} } as unknown as StagehandLogger;

describe("page evaluation in real Chrome", () => {
  let chrome: Awaited<ReturnType<typeof launchLocalBrowser>>;
  let connection: CdpConnection;

  beforeAll(async () => {
    chrome = await launchLocalBrowser({ headless: true }, AbortSignal.timeout(30_000));
    const version = await (await fetch(`${chrome.cdpUrl}/json/version`)).json();
    connection = await CdpConnection.connect(
      version.webSocketDebuggerUrl,
      browserWebSocketFactory,
      logger,
    );
  }, 35_000);

  afterAll(async () => {
    await connection?.close();
    await chrome?.close();
  });

  async function withFrame(
    run: (frame: Frame, session: CDPSessionLike) => Promise<void>,
    intercept?: (method: string, session: CDPSessionLike, params?: object) => Promise<void>,
  ): Promise<void> {
    const { targetId } = await connection.send<{ targetId: string }>("Target.createTarget", {
      url: "about:blank",
    });
    const session = await connection.attachToTarget(targetId);
    const wrapped: CDPSessionLike = {
      id: session.id,
      send: async <Result>(method: string, params?: object): Promise<Result> => {
        await intercept?.(method, session, params);
        return session.send<Result>(method, params);
      },
      on: session.on.bind(session),
      off: session.off.bind(session),
      close: session.close.bind(session),
    };
    executionContexts.attachSession(wrapped);
    await wrapped.send("Runtime.enable");
    await wrapped.send("Page.enable");
    const { frameTree } = await wrapped.send<{ frameTree: { frame: { id: string } } }>(
      "Page.getFrameTree",
    );
    try {
      await run(new Frame(wrapped, frameTree.frame.id, targetId, false, logger), session);
    } finally {
      await connection.send("Target.closeTarget", { targetId });
    }
  }

  it("retains a promise while forcing garbage collection before awaiting", async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      await withFrame(
        async (frame) => {
          await expect(frame.evaluate(controllablePromise)).resolves.toBe(42);
        },
        async (method, session, params) => {
          if (method === "Runtime.awaitPromise") {
            await session.send("HeapProfiler.collectGarbage");
            await session.send("HeapProfiler.collectGarbage");
            await session.send("Runtime.callFunctionOn", {
              objectId: (params as { promiseObjectId: string }).promiseObjectId,
              functionDeclaration: resolvePromise,
            });
          }
        },
      );
    }
  });

  it("does not expose rejected JavaScript exception details", async () => {
    await withFrame(async (frame) => {
      const error = await frame
        .evaluate('Promise.reject(new Error("PRIVATE_EVALUATION_DETAIL"))')
        .catch((caught: unknown) => caught);
      expect(error).toMatchObject({
        name: "PageEvaluationError",
        message: "Page evaluation failed",
      });
      expect(String(error)).not.toContain("PRIVATE_EVALUATION_DETAIL");
    });
  });

  it("does not replay an expression after its context disappears during materialization", async () => {
    let evaluations = 0;
    await withFrame(
      async (frame) => {
        await expect(frame.evaluate("Promise.resolve(42)")).rejects.toThrow();
        expect(evaluations).toBe(1);
      },
      async (method, session) => {
        if (method === "Runtime.evaluate") evaluations++;
        if (method === "Runtime.awaitPromise") {
          const loaded = new Promise<void>((resolve) => {
            const onLoad = () => {
              session.off("Page.loadEventFired", onLoad);
              resolve();
            };
            session.on("Page.loadEventFired", onLoad);
          });
          await session.send("Page.navigate", { url: "about:blank?replacement" });
          await loaded;
        }
      },
    );
  });

  it("preserves results and sanitized errors through the public SDK", async () => {
    const browser = await localBrowser.launch({ headless: true });
    let stagehand: Stagehand | undefined;
    try {
      stagehand = await Stagehand.create({
        browser,
        model: {
          generate: async () => {
            throw new Error("Unexpected model call");
          },
        },
        logging: { level: "off" },
      });
      const page = await browser.context.newPage("data:text/html,<title>Evaluation</title>");
      await expect(page.evaluate("({ answer: 42 })")).resolves.toEqual({ answer: 42 });
      await expect(page.evaluate("Promise.resolve({ answer: 42 })")).resolves.toEqual({
        answer: 42,
      });
      await expect(page.evaluate("40 + 2")).resolves.toBe(42);
      const error = await page
        .evaluate('Promise.reject(new Error("PRIVATE_EVALUATION_DETAIL"))')
        .catch((caught: unknown) => caught);
      expect(String(error)).toContain("Page evaluation failed");
      expect(String(error)).not.toContain("PRIVATE_EVALUATION_DETAIL");
    } finally {
      await stagehand?.close();
      await browser.close();
    }
  });
});
