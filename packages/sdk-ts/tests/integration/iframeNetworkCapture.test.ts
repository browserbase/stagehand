/// <reference types="chrome" />

import { trace } from "@opentelemetry/api";
import { afterEach, describe, expect, it } from "vitest";
import { StagehandLogger } from "../../../extension/logger.js";
import type { NetworkRequestInfo } from "../../../extension/types/private/network.js";
import { browserWebSocketFactory } from "../../../extension/understudy/browserWebSocketTransport.js";
import type { CdpWebSocketFactory } from "../../../extension/understudy/cdp.js";
import { BrowserContext } from "../../../extension/understudy/context.js";
import type { Response } from "../../../extension/understudy/response.js";
import { launchLocalBrowser } from "../../src/browser/localBrowser.js";
import { startFixtureServer, type FixtureServer } from "./_support.js";

/** Hold only iframe ownership discovery; Chrome and its network events keep running. */
function frameTreeGate() {
  let mainSessionId: string | null = null;
  let released = false;
  const pending: Array<() => void> = [];
  const factory: CdpWebSocketFactory = async (url) => {
    const transport = await browserWebSocketFactory(url);
    return {
      get connected() {
        return transport.connected;
      },
      send(payload) {
        const command = JSON.parse(payload) as { method: string; sessionId?: string };
        if (
          !released &&
          mainSessionId &&
          command.sessionId !== mainSessionId &&
          command.method === "Page.getFrameTree"
        ) {
          pending.push(() => transport.send(payload));
        } else {
          transport.send(payload);
        }
      },
      close: () => transport.close(),
      onMessage: (handler) => transport.onMessage(handler),
      onClose: (handler) => transport.onClose(handler),
      onError: (handler) => transport.onError(handler),
    };
  };
  return {
    factory,
    holdChildrenOf(sessionId: string | null) {
      mainSessionId = sessionId;
    },
    get pendingCount() {
      return pending.length;
    },
    release() {
      released = true;
      for (const send of pending.splice(0)) send();
    },
  };
}

describe("iframe network capture in Chrome", () => {
  let browser: Awaited<ReturnType<typeof launchLocalBrowser>> | undefined;
  let context: BrowserContext | undefined;
  let fixture: FixtureServer | undefined;

  afterEach(async () => {
    try {
      await context?.close();
    } finally {
      try {
        await browser?.close();
      } finally {
        await fixture?.close();
      }
    }
  });

  it.each([
    { name: "same-process", crossProcess: false, nested: false },
    { name: "cross-process", crossProcess: true, nested: false },
    { name: "nested cross-process", crossProcess: true, nested: true },
  ])(
    "tracks document bodies and immediate/later fetches exactly once ($name)",
    async ({ crossProcess, nested }) => {
      const served: string[] = [];
      fixture = await startFixtureServer({
        "/": `<!doctype html><body><script>
        addEventListener('message', event => {
          if (event.source === document.querySelector('iframe')?.contentWindow)
            document.body.dataset[event.data] = 'done';
        });
      </script></body>`,
        "/child": `<!doctype html><script>
        async function fetchAndReport(name) {
          const response = await fetch('/api/' + name);
          await response.text();
          parent.postMessage(name, '*');
        }
        fetchAndReport('immediate');
        addEventListener('message', event => {
          if (event.source === parent && event.data === 'later') fetchAndReport('later');
        });
      </script>`,
        "/outer": () => {
          const url = new URL("/child", fixture!.url);
          url.hostname = "grandchild.test";
          return `<!doctype html><iframe src="${url.href}"></iframe><script>
            addEventListener('message', event => {
              const child = document.querySelector('iframe').contentWindow;
              if (event.source === parent) child.postMessage(event.data, '*');
              else if (event.source === child) parent.postMessage(event.data, '*');
            });
          </script>`;
        },
        "/api/immediate": () => {
          served.push("immediate");
          return "ok";
        },
        "/api/later": () => {
          served.push("later");
          return "ok";
        },
      });
      browser = await launchLocalBrowser({
        headless: true,
        args: [
          "--host-resolver-rules=MAP child.test 127.0.0.1,MAP grandchild.test 127.0.0.1",
          "--site-per-process",
          "--no-proxy-server",
        ],
      });
      const version = (await fetch(`${browser.cdpUrl}/json/version`).then((response) =>
        response.json(),
      )) as { webSocketDebuggerUrl: string };
      const gate = frameTreeGate();
      // Use the real Understudy context directly to observe its internal request
      // lifecycle notifications. No extension build is needed.
      context = await BrowserContext.create(version.webSocketDebuggerUrl, {
        websocketFactory: gate.factory,
        blankPageUrl: "about:blank",
        fallbackLocatorScriptSource: "",
        chromeTabs: {
          activeTargetId: async () => undefined,
          targetIdForTabId: async () => undefined,
          tabIdForTargetId: async () => undefined,
          activateTarget: async () => {},
        },
        logger: new StagehandLogger(
          { tracer: trace.getTracer("iframe-network-test") },
          () => {},
          undefined,
          "off",
        ),
      });
      const page = context.pages()[0]!;
      await page.goto(fixture.url);
      gate.holdChildrenOf(page.mainSession.id);
      const events: Array<{ kind: string; info: NetworkRequestInfo }> = [];
      const record = (kind: string, info: NetworkRequestInfo) => {
        if (info.url?.includes("/api/")) events.push({ kind, info });
      };
      page.networkManager.addObserver({
        onRequestStarted: (info) => record("start", info),
        onRequestFinished: (info) => record("finish", info),
        onRequestFailed: (info) => record("fail", info),
      });
      const documentResponses: Response[] = [];
      await page.subscribeResponse((response) => {
        if (new URL(response.url()).pathname === "/child") documentResponses.push(response);
      });
      const childUrl = new URL(nested ? "/outer" : "/child", fixture.url);
      if (crossProcess) childUrl.hostname = "child.test";
      const resourceUrl = new URL("/child", childUrl);
      if (nested) resourceUrl.hostname = "grandchild.test";
      await page.evaluate((url) => {
        const iframe = document.createElement("iframe");
        iframe.src = url;
        document.body.append(iframe);
      }, childUrl.href);
      await expect
        .poll(() => page.evaluate(() => document.body.dataset.immediate), { timeout: 10_000 })
        .toBe("done");
      expect(served).toEqual(["immediate"]);
      if (crossProcess) {
        await expect.poll(() => gate.pendingCount, { timeout: 10_000 }).toBe(nested ? 2 : 1);
        // The fetch finished in Chrome while the page still has no child session.
        expect(events).toEqual([]);
        expect(page.networkManager.sessions.size).toBe(1);
      }
      gate.release();
      await expect
        .poll(() => events.map((event) => event.kind), { timeout: 10_000 })
        .toEqual(["start", "finish"]);
      const immediate = events[0]!.info;
      expect(events[1]!.info.requestKey).toBe(immediate.requestKey);
      expect(immediate.url).toBe(new URL("/api/immediate", resourceUrl).href);
      expect(immediate.sessionId === page.mainSession.id).toBe(!crossProcess);

      await expect.poll(() => documentResponses.length, { timeout: 10_000 }).toBe(1);
      const documentResponse = documentResponses[0]!;
      await expect.poll(() => documentResponse.finishedSettled, { timeout: 10_000 }).toBe(true);
      await expect(documentResponse.finished()).resolves.toBeNull();
      await expect(documentResponse.text()).resolves.toContain("fetchAndReport('immediate')");
      expect(documentResponse.session.id).toBe(immediate.sessionId);

      // Trigger the second request only after adoption, covering the same capture's live path.
      await page.evaluate(() =>
        document.querySelector("iframe")!.contentWindow!.postMessage("later", "*"),
      );
      await expect
        .poll(() => page.evaluate(() => document.body.dataset.later), { timeout: 10_000 })
        .toBe("done");
      await expect
        .poll(() => events.map((event) => event.kind), { timeout: 10_000 })
        .toEqual(["start", "finish", "start", "finish"]);
      expect(served).toEqual(["immediate", "later"]);
      expect(events[2]!.info.url).toBe(new URL("/api/later", resourceUrl).href);
      expect(events[2]!.info.sessionId).toBe(immediate.sessionId);
      expect(events[3]!.info.requestKey).toBe(events[2]!.info.requestKey);
      expect(page.networkManager.requests.has(immediate.requestKey)).toBe(false);
      expect(page.networkManager.requests.has(events[2]!.info.requestKey)).toBe(false);

      await page.evaluate(() => document.querySelector("iframe")!.remove());
      if (crossProcess)
        await expect
          .poll(() => page.networkManager.sessions.has(immediate.sessionId), { timeout: 10_000 })
          .toBe(false);
    },
  );
});
