import { afterEach, describe, expect, it, vi } from "vitest";
import type { StagehandLogger } from "../logger.js";
import { CdpConnection, type CdpWebSocketTransport } from "../understudy/cdp.js";
import type { ChromeTabTargetController } from "../understudy/chromeTabs.js";
import { BrowserContext } from "../understudy/context.js";
import { SessionNetworkCapture } from "../understudy/sessionNetworkCapture.js";

const PAGE_SESSION = "page-session";
const CHILD_SESSION = "child-session";
const PAGE_TARGET = { targetId: "page-target", type: "page", url: "https://app.example.com/" };
const CHILD_TARGET = {
  targetId: "child-target",
  type: "iframe",
  url: "https://child.example.net/",
};
type Command = { id: number; method: string; sessionId?: string };

function frame(id: string, url: string, parentId?: string) {
  return {
    id,
    parentId,
    loaderId: `${id}-loader`,
    url,
    domainAndRegistry: "",
    securityOrigin: new URL(url).origin,
    mimeType: "text/html",
    secureContextType: "Secure",
    crossOriginIsolatedContextType: "NotIsolated",
    gatedAPIFeatures: [],
  };
}

/** Emits iframe traffic at resume, before the frame-tree query can identify its owner. */
class PausedIframeBrowser implements CdpWebSocketTransport {
  connected = true;
  readonly commands: Command[] = [];
  private messageHandler: (data: string) => void = () => {};
  private networkEnabled = false;
  private enableReply?: () => void;
  private childFrameTreeRequests = 0;
  releaseFrameTree?: () => void;

  constructor(
    readonly opts: { unknownParent?: boolean; failFrameTree?: boolean; failResume?: boolean } = {},
  ) {}

  send(payload: string): void {
    const command = JSON.parse(payload) as Command;
    this.commands.push(command);
    void this.respond(command);
  }
  async close(): Promise<void> {
    this.connected = false;
  }
  onMessage(handler: (data: string) => void): void {
    this.messageHandler = handler;
  }
  onClose(): void {}
  onError(): void {}

  emit(method: string, params: unknown, sessionId?: string): void {
    this.messageHandler(JSON.stringify({ method, params, sessionId }));
  }

  attachChild(): void {
    this.emit(
      "Target.attachedToTarget",
      {
        sessionId: CHILD_SESSION,
        targetInfo: { ...CHILD_TARGET, attached: true },
        waitingForDebugger: true,
      },
      PAGE_SESSION,
    );
  }

  private async respond({ id, method, sessionId }: Command): Promise<void> {
    await new Promise<void>((resolve) => setImmediate(resolve));
    const reply = (result: unknown = {}) =>
      this.messageHandler(JSON.stringify({ id, result, sessionId }));
    const fail = () =>
      this.messageHandler(
        JSON.stringify({ id, sessionId, error: { code: -32000, message: "Target unavailable" } }),
      );
    if (method === "Target.getTargets")
      return reply({ targetInfos: [{ ...PAGE_TARGET, attached: true }] });
    if (method === "Target.setAutoAttach" && !sessionId) {
      reply();
      this.emit("Target.attachedToTarget", {
        sessionId: PAGE_SESSION,
        targetInfo: { ...PAGE_TARGET, attached: true },
        waitingForDebugger: true,
      });
      return;
    }
    if (method === "Page.getFrameTree" && sessionId === PAGE_SESSION) {
      return reply({ frameTree: { frame: frame("main", PAGE_TARGET.url) } });
    }
    if (sessionId === CHILD_SESSION) {
      if (method === "Network.enable" && !this.networkEnabled) {
        this.networkEnabled = true;
        // Some backends only reply after resume. Waiting for this reply first would deadlock.
        this.enableReply = reply;
        return;
      }
      if (method === "Runtime.runIfWaitingForDebugger") {
        this.enableReply?.();
        if (this.opts.failResume) return fail();
        if (this.networkEnabled) {
          for (const requestId of ["completed", "failed", "inflight"]) {
            this.emit(
              "Network.requestWillBeSent",
              {
                requestId,
                frameId: "child",
                loaderId: "child-loader",
                type: "Fetch",
                request: { url: `${CHILD_TARGET.url}${requestId}` },
              },
              sessionId,
            );
            this.emit(
              "Network.responseReceived",
              {
                requestId,
                type: "Fetch",
                response: { url: `${CHILD_TARGET.url}${requestId}`, status: 200 },
              },
              sessionId,
            );
            if (requestId !== "inflight") {
              this.emit(
                requestId === "failed" ? "Network.loadingFailed" : "Network.loadingFinished",
                { requestId },
                sessionId,
              );
            }
          }
        }
      }
      if (method === "Page.getFrameTree") {
        const respond = () =>
          this.opts.failFrameTree
            ? fail()
            : reply({
                frameTree: {
                  frame: frame(
                    "child",
                    CHILD_TARGET.url,
                    this.opts.unknownParent ? "wrapper" : "main",
                  ),
                },
              });
        if (++this.childFrameTreeRequests === 1) this.releaseFrameTree = respond;
        else respond();
        return;
      }
    }
    reply();
  }
}

const noop = () => {};
const logger = { debug: noop, info: noop, warn: noop, error: noop } as unknown as StagehandLogger;
const chromeTabs: ChromeTabTargetController = {
  activeTargetId: async () => undefined,
  targetIdForTabId: async () => undefined,
  tabIdForTargetId: async () => undefined,
  activateTarget: async () => {},
};
const contexts: BrowserContext[] = [];

async function connect(browser: PausedIframeBrowser) {
  const context = new BrowserContext(new CdpConnection(browser, logger), logger, chromeTabs);
  contexts.push(context);
  await context.bootstrap();
  await vi.waitFor(() => expect(context.pages()).toHaveLength(1));
  const page = context.pages()[0]!;
  const events: string[] = [];
  page.networkManager.addObserver({
    onRequestStarted: (info) => events.push(`start:${info.requestId}`),
    onRequestFinished: (info) => events.push(`finish:${info.requestId}`),
    onRequestFailed: (info) => events.push(`fail:${info.requestId}`),
  });
  browser.attachChild();
  return { context, page, events };
}

const bufferedEvents = [
  "start:completed",
  "finish:completed",
  "start:failed",
  "fail:failed",
  "start:inflight",
];

afterEach(async () => {
  await Promise.all(contexts.splice(0).map((context) => context.close()));
  vi.restoreAllMocks();
});

describe("BrowserContext pre-resume iframe network capture", () => {
  it("captures requests at resume and transfers buffered and live events exactly once", async () => {
    const browser = new PausedIframeBrowser();
    const { context, page, events } = await connect(browser);
    await vi.waitFor(() => expect(browser.releaseFrameTree).toBeDefined());
    expect(events).toEqual([]);
    const methods = browser.commands
      .filter((command) => command.sessionId === CHILD_SESSION)
      .map((command) => command.method);
    expect(methods.indexOf("Network.enable")).toBeGreaterThanOrEqual(0);
    expect(methods.indexOf("Network.enable")).toBeLessThan(
      methods.indexOf("Runtime.runIfWaitingForDebugger"),
    );

    browser.releaseFrameTree!();
    await vi.waitFor(() => expect(events).toEqual(bufferedEvents));
    expect(context.sessionOwnerPage.get(CHILD_SESSION)).toBe(page);
    expect([...page.networkManager.requests.keys()]).toEqual([`${CHILD_SESSION}:inflight`]);

    browser.emit("Network.loadingFinished", { requestId: "inflight" }, CHILD_SESSION);
    await vi.waitFor(() => expect(events).toEqual([...bufferedEvents, "finish:inflight"]));
    expect(page.networkManager.requests.size).toBe(0);
    page.networkManager.untrackSession(CHILD_SESSION);
    browser.emit("Network.requestWillBeSent", { requestId: "after-untrack" }, CHILD_SESSION);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(events).toHaveLength(6);
  });

  it("retains traffic until a previously unknown parent frame becomes owned", async () => {
    const browser = new PausedIframeBrowser({ unknownParent: true });
    const { context, events } = await connect(browser);
    await vi.waitFor(() => expect(browser.releaseFrameTree).toBeDefined());
    browser.releaseFrameTree!();
    await vi.waitFor(() =>
      expect(context.pendingOopifByMainFrame.get("child")).toBe(CHILD_SESSION),
    );
    expect(events).toEqual([]);
    browser.emit("Network.loadingFinished", { requestId: "inflight" }, CHILD_SESSION);
    browser.emit("Page.frameAttached", { frameId: "wrapper", parentFrameId: "main" }, PAGE_SESSION);
    await vi.waitFor(() => expect(events).toEqual([...bufferedEvents, "finish:inflight"]));
    expect(context.pendingOopifByMainFrame.size).toBe(0);
  });

  it.each(["detach", "destroy", "close", "frame-tree failure"] as const)(
    "disposes buffered traffic on %s before adoption",
    async (action) => {
      const dispose = vi.spyOn(SessionNetworkCapture.prototype, "dispose");
      const browser = new PausedIframeBrowser({ failFrameTree: action === "frame-tree failure" });
      const { context, page, events } = await connect(browser);
      await vi.waitFor(() => expect(browser.releaseFrameTree).toBeDefined());
      if (action === "detach")
        browser.emit(
          "Target.detachedFromTarget",
          { sessionId: CHILD_SESSION, targetId: CHILD_TARGET.targetId },
          PAGE_SESSION,
        );
      if (action === "destroy")
        browser.emit("Target.targetDestroyed", { targetId: CHILD_TARGET.targetId });
      if (action === "close") await context.close();
      if (action === "frame-tree failure") browser.releaseFrameTree!();
      await vi.waitFor(() =>
        expect(
          dispose.mock.contexts.some(
            (capture) =>
              capture instanceof SessionNetworkCapture && capture.session.id === CHILD_SESSION,
          ),
        ).toBe(true),
      );
      if (action !== "frame-tree failure") browser.releaseFrameTree!();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(events).toEqual([]);
      expect(page.networkManager.sessions.has(CHILD_SESSION)).toBe(false);
      expect(page.networkManager.requests.size).toBe(0);
    },
  );

  it("disposes capture if resuming the iframe fails", async () => {
    const dispose = vi.spyOn(SessionNetworkCapture.prototype, "dispose");
    const { page, events } = await connect(new PausedIframeBrowser({ failResume: true }));
    await vi.waitFor(() =>
      expect(
        dispose.mock.contexts.some(
          (capture) =>
            capture instanceof SessionNetworkCapture && capture.session.id === CHILD_SESSION,
        ),
      ).toBe(true),
    );
    expect(page.networkManager.sessions.has(CHILD_SESSION)).toBe(false);
    expect(events).toEqual([]);
  });
});
