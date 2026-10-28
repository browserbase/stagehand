import { afterEach, describe, expect, it, vi } from "vitest";
import type { StagehandLogger } from "../logger.ts";
import { CdpConnection } from "../understudy/cdp.ts";
import type { CdpWebSocketTransport } from "../understudy/cdp.ts";
import type { ChromeTabTargetController } from "../understudy/chromeTabs.ts";
import { BrowserContext } from "../understudy/context.ts";
import type { Page } from "../understudy/page.ts";

const MAIN_FRAME = "main-frame";
const EDITOR_FRAME = "editor-frame";
const NESTED_FRAME = "nested-frame";
const WRAPPER_FRAME = "wrapper-frame";
const PAGE_SESSION = "page-session";
const EDITOR_SESSION = "editor-session";
const NESTED_SESSION = "nested-session";
const PAGE_TARGET = { targetId: "page-target", type: "page", url: "https://app.example.com/" };
const EDITOR_TARGET = {
  targetId: "editor-target",
  type: "iframe",
  url: "https://editor.example.net/",
};
const NESTED_TARGET = {
  targetId: "nested-target",
  type: "iframe",
  url: "https://widget.example.org/",
};

function frame(id: string, url: string, parentId?: string) {
  return {
    id,
    ...(parentId && { parentId }),
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

type CdpRequest = { id: number; method: string; sessionId?: string };

/**
 * A browser whose tab already hosts a loaded cross-origin iframe: the page's frame tree omits
 * the remote frame and no `Page.frameAttached` is emitted for it.
 */
class BrowserWithLoadedOopif implements CdpWebSocketTransport {
  connected = true;
  messageHandler: (data: string) => void = () => {};
  releasePageFrameTree: (() => void) | undefined;

  constructor(
    readonly opts: {
      editorRegistersFirst?: boolean;
      nested?: boolean;
      editorInsideWrapper?: boolean;
    } = {},
  ) {}

  send(payload: string): void {
    void this.respond(JSON.parse(payload) as CdpRequest);
  }

  async close(): Promise<void> {
    this.connected = false;
  }

  onMessage(handler: (data: string) => void): void {
    this.messageHandler = handler;
  }

  onClose(): void {}

  onError(): void {}

  emitEvent(method: string, params: unknown, sessionId?: string): void {
    this.messageHandler(JSON.stringify({ method, params, ...(sessionId && { sessionId }) }));
  }

  attach(sessionId: string, targetInfo: object, parentSessionId?: string): void {
    this.emitEvent(
      "Target.attachedToTarget",
      { sessionId, targetInfo: { ...targetInfo, attached: true }, waitingForDebugger: false },
      parentSessionId,
    );
  }

  async respond({ id, method, sessionId }: CdpRequest): Promise<void> {
    await new Promise((resolve) => setImmediate(resolve));
    const reply = (result: unknown = {}) =>
      this.messageHandler(JSON.stringify({ id, result, ...(sessionId && { sessionId }) }));

    if (method === "Target.getTargets") {
      const targets = [PAGE_TARGET, EDITOR_TARGET, ...(this.opts.nested ? [NESTED_TARGET] : [])];
      return reply({ targetInfos: targets.map((target) => ({ ...target, attached: true })) });
    }
    if (method === "Page.getFrameTree" && sessionId === PAGE_SESSION) {
      if (this.opts.editorRegistersFirst) {
        await new Promise<void>((resolve) => (this.releasePageFrameTree = resolve));
      }
      return reply({ frameTree: { frame: frame(MAIN_FRAME, PAGE_TARGET.url) } });
    }
    if (method === "Page.getFrameTree" && sessionId === EDITOR_SESSION) {
      const parent = this.opts.editorInsideWrapper ? WRAPPER_FRAME : MAIN_FRAME;
      reply({ frameTree: { frame: frame(EDITOR_FRAME, EDITOR_TARGET.url, parent) } });
      await new Promise((resolve) => setImmediate(resolve));
      this.releasePageFrameTree?.();
      return;
    }
    if (method === "Page.getFrameTree" && sessionId === NESTED_SESSION) {
      return reply({ frameTree: { frame: frame(NESTED_FRAME, NESTED_TARGET.url, EDITOR_FRAME) } });
    }
    reply();
    if (method !== "Target.setAutoAttach") return;
    if (!sessionId) this.attach(PAGE_SESSION, PAGE_TARGET);
    if (sessionId === PAGE_SESSION) this.attach(EDITOR_SESSION, EDITOR_TARGET, PAGE_SESSION);
    if (sessionId === EDITOR_SESSION && this.opts.nested) {
      this.attach(NESTED_SESSION, NESTED_TARGET, EDITOR_SESSION);
    }
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

async function connect(browser: BrowserWithLoadedOopif) {
  const context = new BrowserContext(new CdpConnection(browser, logger), logger, chromeTabs);
  contexts.push(context);
  await context.bootstrap();
  await vi.waitFor(() => expect(context.pages()).toHaveLength(1));
  return { context, page: context.pages()[0]! };
}

async function expectOwnedBySession(page: Page, frameId: string, sessionId: string) {
  await vi.waitFor(() => {
    expect(page.listAllFrameIds()).toContain(frameId);
    expect(page.getSessionForFrame(frameId).id).toBe(sessionId);
  });
}

describe("BrowserContext OOPIF adoption", () => {
  afterEach(async () => {
    await Promise.all(contexts.splice(0).map((context) => context.close()));
  });

  it("adopts a cross-origin iframe that was already loaded before bootstrap", async () => {
    const { page } = await connect(new BrowserWithLoadedOopif());

    await expectOwnedBySession(page, EDITOR_FRAME, EDITOR_SESSION);
  });

  it("adopts the iframe once its parent page registers when the iframe attaches first", async () => {
    const { context, page } = await connect(
      new BrowserWithLoadedOopif({ editorRegistersFirst: true }),
    );

    await expectOwnedBySession(page, EDITOR_FRAME, EDITOR_SESSION);
    expect(context.pendingOopifByMainFrame.size).toBe(0);
    expect(context.pendingOopifParentByMainFrame.size).toBe(0);
  });

  it("keeps the iframe session as owner when the parent reports the frame late", async () => {
    const browser = new BrowserWithLoadedOopif();
    const { context, page } = await connect(browser);
    await expectOwnedBySession(page, EDITOR_FRAME, EDITOR_SESSION);

    browser.emitEvent(
      "Page.frameAttached",
      { frameId: EDITOR_FRAME, parentFrameId: MAIN_FRAME },
      PAGE_SESSION,
    );
    browser.emitEvent(
      "Page.frameAttached",
      { frameId: "same-origin-frame", parentFrameId: MAIN_FRAME },
      PAGE_SESSION,
    );
    await context.conn.messageQueue;

    expect(page.listAllFrameIds()).toContain("same-origin-frame");
    expect(page.getSessionForFrame(EDITOR_FRAME).id).toBe(EDITOR_SESSION);
  });

  it("adopts an OOPIF nested inside another OOPIF", async () => {
    const { page } = await connect(new BrowserWithLoadedOopif({ nested: true }));

    await expectOwnedBySession(page, EDITOR_FRAME, EDITOR_SESSION);
    await expectOwnedBySession(page, NESTED_FRAME, NESTED_SESSION);
  });

  it("keeps the nested iframe session as owner when the outer iframe reports it late", async () => {
    const browser = new BrowserWithLoadedOopif({ nested: true });
    const { context, page } = await connect(browser);
    await expectOwnedBySession(page, EDITOR_FRAME, EDITOR_SESSION);
    await expectOwnedBySession(page, NESTED_FRAME, NESTED_SESSION);

    browser.emitEvent(
      "Page.frameAttached",
      { frameId: NESTED_FRAME, parentFrameId: EDITOR_FRAME },
      EDITOR_SESSION,
    );
    browser.emitEvent(
      "Page.frameAttached",
      { frameId: "same-origin-frame", parentFrameId: EDITOR_FRAME },
      EDITOR_SESSION,
    );
    await context.conn.messageQueue;

    expect(page.getSessionForFrame(NESTED_FRAME).id).toBe(NESTED_SESSION);
    expect(page.listAllFrameIds()).toContain("same-origin-frame");
    expect(page.getSessionForFrame("same-origin-frame").id).toBe(EDITOR_SESSION);
  });

  it("allows the outer session to own the frame after the nested session detaches", async () => {
    const browser = new BrowserWithLoadedOopif({ nested: true });
    const { context, page } = await connect(browser);
    await expectOwnedBySession(page, EDITOR_FRAME, EDITOR_SESSION);
    await expectOwnedBySession(page, NESTED_FRAME, NESTED_SESSION);

    browser.emitEvent(
      "Target.detachedFromTarget",
      { sessionId: NESTED_SESSION, targetId: NESTED_TARGET.targetId },
      EDITOR_SESSION,
    );
    browser.emitEvent(
      "Page.frameAttached",
      { frameId: NESTED_FRAME, parentFrameId: EDITOR_FRAME },
      EDITOR_SESSION,
    );
    await context.conn.messageQueue;

    expect(page.listAllFrameIds()).toContain(NESTED_FRAME);
    expect(page.getSessionForFrame(NESTED_FRAME).id).toBe(EDITOR_SESSION);
  });

  it("adopts waiting OOPIFs once the page reports the frame that contains them", async () => {
    const browser = new BrowserWithLoadedOopif({ nested: true, editorInsideWrapper: true });
    const { context, page } = await connect(browser);
    await vi.waitFor(() => expect(context.pendingOopifByMainFrame.size).toBe(2));

    browser.emitEvent(
      "Page.frameAttached",
      { frameId: WRAPPER_FRAME, parentFrameId: MAIN_FRAME },
      PAGE_SESSION,
    );

    await expectOwnedBySession(page, EDITOR_FRAME, EDITOR_SESSION);
    await expectOwnedBySession(page, NESTED_FRAME, NESTED_SESSION);
  });
});
