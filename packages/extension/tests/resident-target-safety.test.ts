import type { Protocol } from "devtools-protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChromeTabTargetController } from "../understudy/chromeTabs.ts";
import { CdpConnection } from "../understudy/cdp.ts";
import { BrowserContext, isSupportedWebTarget } from "../understudy/context.ts";
import { Page } from "../understudy/page.ts";

function target(
  targetId: string,
  type: string,
  url: string,
  attached = false,
): Protocol.Target.TargetInfo {
  return { targetId, type, title: targetId, url, attached, canAccessOpener: false };
}

const chromeTabs: ChromeTabTargetController = {
  activeTargetId: async () => undefined,
  targetIdForTabId: async () => undefined,
  tabIdForTargetId: async () => undefined,
  activateTarget: async () => {},
};

function bootstrapConnection(targets: Protocol.Target.TargetInfo[]) {
  const attachToTarget = vi.fn(async () => ({}));
  let targetInfoChanged: ((event: Protocol.Target.TargetInfoChangedEvent) => void) | undefined;
  const connection = {
    connected: true,
    on: vi.fn((event: string, handler: (event: never) => void) => {
      if (event === "Target.targetInfoChanged") targetInfoChanged = handler;
    }),
    enableAutoAttach: vi.fn(async () => {}),
    getTargets: vi.fn(async () => targets),
    attachToTarget,
  };
  return { connection, attachToTarget, getTargetInfoChanged: () => targetInfoChanged };
}

function pageSession(id: string, frameId = "main") {
  const send = vi.fn(async (method: string) => {
    if (method === "Page.getFrameTree") {
      return { frameTree: { frame: { id: frameId, url: "https://example.com" } } };
    }
    return {};
  });
  return { id, send, on: vi.fn(), off: vi.fn(), close: vi.fn(async () => {}) };
}

describe("resident target attachment safety", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps default page tracking and only allows injectable iframes", () => {
    for (const url of [
      "about:blank",
      "chrome://newtab",
      "chrome-extension://other/x.html",
      "about:blank?x",
    ]) {
      expect(isSupportedWebTarget(target(url, "page", url))).toBe(true);
    }
    expect(isSupportedWebTarget(target("web-frame", "iframe", "https://example.com"))).toBe(true);
    expect(
      isSupportedWebTarget(target("extension-frame", "iframe", "chrome-extension://other")),
    ).toBe(false);
    expect(isSupportedWebTarget(target("blank-frame", "iframe", "about:blank?x"))).toBe(true);
    for (const type of [
      "browser",
      "service_worker",
      "worker",
      "shared_worker",
      "background_page",
      "other",
    ]) {
      expect(isSupportedWebTarget(target(type, type, "https://example.com"))).toBe(false);
    }
  });

  it("restricts resident pages to injectable URLs and the configured blank page", () => {
    const restricted = { restrictToWebTargets: true };
    expect(isSupportedWebTarget(target("newtab", "page", "chrome://newtab"), restricted)).toBe(
      false,
    );
    expect(
      isSupportedWebTarget(
        target("extension", "page", "chrome-extension://other/x.html"),
        restricted,
      ),
    ).toBe(false);
    expect(isSupportedWebTarget(target("web", "page", "https://example.com"), restricted)).toBe(
      true,
    );
    expect(isSupportedWebTarget(target("blank", "page", "about:blank?x"), restricted)).toBe(true);
    expect(
      isSupportedWebTarget(target("ours", "page", "chrome-extension://stagehand/blank.html"), {
        restrictToWebTargets: true,
        blankPageUrl: "chrome-extension://stagehand/blank.html",
      }),
    ).toBe(true);
  });

  it("tracks a headful new-tab page during default bootstrap", async () => {
    const targets = [
      target("new-tab", "page", "chrome://newtab"),
      target("worker", "worker", "https://example.com/worker.js"),
    ];
    const { connection, attachToTarget } = bootstrapConnection(targets);
    const context = new BrowserContext(connection as never, {} as never, chromeTabs);
    const wait = vi.spyOn(context, "waitForInitialTopLevelTargets").mockResolvedValue();

    await context.bootstrap();

    expect(attachToTarget.mock.calls).toStrictEqual([["new-tab"]]);
    expect(wait).toHaveBeenCalledWith(["new-tab"]);
  });

  it("fully initializes a default-mode chrome new-tab attachment", async () => {
    const session = pageSession("session-1");
    const rootSend = vi.fn(async () => ({}));
    const context = new BrowserContext(
      {
        getSession: vi.fn(() => session),
        waitForSessionDispatch: vi.fn(async () => {}),
        send: rootSend,
      } as never,
      { debug: vi.fn() } as never,
      chromeTabs,
    );

    await context.onAttachedToTarget(target("new-tab", "page", "chrome://newtab"), "session-1");

    expect(context._sessionInit.has("session-1")).toBe(true);
    expect(session.send).toHaveBeenCalledWith("Page.enable", undefined);
    expect(session.send).toHaveBeenCalledWith("Runtime.enable", undefined);
    expect(rootSend).not.toHaveBeenCalledWith("Target.detachFromTarget", expect.anything());
    expect(context.pagesByTarget.has("new-tab")).toBe(true);
  });

  it("filters the resident initial sweep while retaining Stagehand's blank page", async () => {
    const targets = [
      target("page", "page", "about:blank"),
      target("iframe", "iframe", "https://example.com/frame"),
      target("worker", "worker", "https://example.com/worker.js"),
      target("service-worker", "service_worker", "chrome-extension://stagehand/sw.js"),
      target("background", "background_page", "chrome-extension://other/background.html"),
      target("new-tab", "page", "chrome://newtab"),
      target("blank", "page", "chrome-extension://stagehand/blank.html"),
    ];
    const { connection, attachToTarget } = bootstrapConnection(targets);
    const context = new BrowserContext(
      connection as never,
      {} as never,
      chromeTabs,
      "LOCAL",
      null,
      "chrome-extension://stagehand/blank.html",
      null,
      { restrictToWebTargets: true },
    );
    const wait = vi.spyOn(context, "waitForInitialTopLevelTargets").mockResolvedValue();

    await context.bootstrap();

    expect(attachToTarget.mock.calls).toStrictEqual([["page"], ["iframe"], ["blank"]]);
    expect(wait).toHaveBeenCalledWith(["page", "blank"]);
  });

  it("reattaches an ignored resident page after navigation to the web", async () => {
    const { connection, attachToTarget, getTargetInfoChanged } = bootstrapConnection([
      target("new-tab", "page", "chrome://newtab"),
    ]);
    const context = new BrowserContext(
      connection as never,
      {} as never,
      chromeTabs,
      "LOCAL",
      null,
      "about:blank",
      null,
      { restrictToWebTargets: true },
    );
    vi.spyOn(context, "waitForInitialTopLevelTargets").mockResolvedValue();
    await context.bootstrap();
    expect(attachToTarget).not.toHaveBeenCalled();

    getTargetInfoChanged()?.({
      targetInfo: target("new-tab", "page", "https://example.com"),
    });
    await vi.waitFor(() => expect(attachToTarget).toHaveBeenCalledWith("new-tab"));
  });

  it("does not root-attach resident iframe target-info changes", async () => {
    const { connection, attachToTarget, getTargetInfoChanged } = bootstrapConnection([]);
    const context = new BrowserContext(
      connection as never,
      {} as never,
      chromeTabs,
      "LOCAL",
      null,
      "about:blank",
      null,
      { restrictToWebTargets: true },
    );
    vi.spyOn(context, "waitForInitialTopLevelTargets").mockResolvedValue();
    await context.bootstrap();
    getTargetInfoChanged()?.({
      targetInfo: target("frame", "iframe", "https://example.com/frame"),
    });
    await Promise.resolve();
    expect(attachToTarget).not.toHaveBeenCalled();
  });

  it("leaves target-info attachment unchanged in default mode", async () => {
    const { connection, attachToTarget, getTargetInfoChanged } = bootstrapConnection([]);
    const context = new BrowserContext(connection as never, {} as never, chromeTabs);
    vi.spyOn(context, "waitForInitialTopLevelTargets").mockResolvedValue();
    await context.bootstrap();
    getTargetInfoChanged()?.({ targetInfo: target("page", "page", "https://example.com") });
    await Promise.resolve();
    expect(attachToTarget).not.toHaveBeenCalled();
  });

  it("coalesces repeated resident target-info attachment attempts", async () => {
    let resolveAttachment: (() => void) | undefined;
    const { connection, attachToTarget, getTargetInfoChanged } = bootstrapConnection([]);
    attachToTarget.mockImplementation(
      async () =>
        await new Promise<void>((resolve) => {
          resolveAttachment = resolve;
        }),
    );
    const context = new BrowserContext(
      connection as never,
      {} as never,
      chromeTabs,
      "LOCAL",
      null,
      "about:blank",
      null,
      { restrictToWebTargets: true },
    );
    vi.spyOn(context, "waitForInitialTopLevelTargets").mockResolvedValue();
    await context.bootstrap();
    const event = { targetInfo: target("page", "page", "https://example.com") };
    getTargetInfoChanged()?.(event);
    getTargetInfoChanged()?.(event);
    await vi.waitFor(() => expect(attachToTarget).toHaveBeenCalledTimes(1));
    resolveAttachment?.();
  });

  it("uses the page-and-iframe filter for root auto-attachment", async () => {
    const connection = new CdpConnection(
      {
        connected: true,
        send: vi.fn(),
        close: vi.fn(async () => {}),
        onMessage: vi.fn(),
        onClose: vi.fn(),
        onError: vi.fn(),
      },
      { debug: vi.fn(), error: vi.fn() },
    );
    const send = vi.spyOn(connection, "send").mockResolvedValue({} as never);

    await connection.enableAutoAttach();

    expect(send).toHaveBeenNthCalledWith(1, "Target.setAutoAttach", {
      autoAttach: true,
      flatten: true,
      waitForDebuggerOnStart: true,
      filter: [{ type: "page" }, { type: "iframe" }, { exclude: true }],
    });
  });

  it("detaches an ignored resident target through its reporting parent session", async () => {
    const worker = pageSession("session-worker");
    const rootSend = vi.fn(async () => ({}));
    const parentSend = vi.fn(async () => ({}));
    const context = new BrowserContext(
      { getSession: vi.fn(() => worker), send: rootSend } as never,
      {} as never,
      chromeTabs,
      "LOCAL",
      null,
      "about:blank",
      null,
      { restrictToWebTargets: true },
    );

    await context.onAttachedToTarget(
      target("worker", "worker", "https://example.com/worker.js"),
      "session-worker",
      { send: parentSend } as never,
    );

    expect(worker.send).toHaveBeenCalledWith("Runtime.runIfWaitingForDebugger");
    expect(parentSend).toHaveBeenCalledWith("Target.detachFromTarget", {
      sessionId: "session-worker",
    });
    expect(rootSend).not.toHaveBeenCalledWith("Target.detachFromTarget", expect.anything());
  });

  it("does not detach ignored targets in default mode", async () => {
    const worker = pageSession("session-worker");
    const rootSend = vi.fn(async () => ({}));
    const parentSend = vi.fn(async () => ({}));
    const context = new BrowserContext(
      { getSession: vi.fn(() => worker), send: rootSend } as never,
      {} as never,
      chromeTabs,
    );

    await context.onAttachedToTarget(
      target("worker", "worker", "https://example.com/worker.js"),
      "session-worker",
      { send: parentSend } as never,
    );

    expect(worker.send).toHaveBeenCalledWith("Runtime.runIfWaitingForDebugger");
    expect(parentSend).not.toHaveBeenCalledWith("Target.detachFromTarget", expect.anything());
    expect(rootSend).not.toHaveBeenCalledWith("Target.detachFromTarget", expect.anything());
  });

  it("honors ensureInitialPage false and preserves the default fallback", async () => {
    const connection = {
      connected: true,
      onTransportClosed: vi.fn(),
      close: vi.fn(async () => {}),
    } as unknown as CdpConnection;
    vi.spyOn(CdpConnection, "connect").mockResolvedValue(connection);
    vi.spyOn(BrowserContext.prototype, "bootstrap").mockResolvedValue();
    const newPage = vi.spyOn(BrowserContext.prototype, "newPage").mockResolvedValue({} as never);
    const options = {
      websocketFactory: vi.fn() as never,
      blankPageUrl: "about:blank",
      fallbackLocatorScriptSource: "",
      chromeTabs,
      logger: {} as never,
    };

    await BrowserContext.create("ws://browser.example", { ...options, ensureInitialPage: false });
    expect(newPage).not.toHaveBeenCalled();
    await BrowserContext.create("ws://browser.example", options);
    expect(newPage).toHaveBeenCalledOnce();
  });

  it("defers page and network instrumentation until initialization", async () => {
    const session = pageSession("page-session");
    const page = new Page(
      {} as never,
      session as never,
      "page-target",
      "main",
      {} as never,
      false,
      true,
    );

    expect(session.send).not.toHaveBeenCalled();
    await page.prepareForInitialization();

    expect(session.send).toHaveBeenCalledWith("Page.enable");
    expect(session.send).toHaveBeenCalledWith("Runtime.enable");
    expect(session.send).toHaveBeenCalledWith("Network.enable");
    expect(session.send).toHaveBeenCalledWith("Page.setLifecycleEventsEnabled", {
      enabled: true,
    });
  });

  it("retries deferred page instrumentation after a transient CDP failure", async () => {
    let pageEnableAttempts = 0;
    const session = pageSession("page-session");
    session.send.mockImplementation(async (method: string) => {
      if (method === "Page.enable" && pageEnableAttempts++ === 0) {
        throw new Error("transient Page.enable failure");
      }
      return {};
    });
    const page = new Page(
      {} as never,
      session as never,
      "page-target",
      "main",
      {} as never,
      false,
      true,
    );

    await expect(page.prepareForInitialization()).rejects.toThrow("transient Page.enable failure");
    expect(page.isInstrumentationReady()).toBe(false);
    await page.prepareForInitialization();
    expect(page.isInstrumentationReady()).toBe(true);
    expect(pageEnableAttempts).toBe(2);
  });

  it("instruments OOPIF sessions according to deferred readiness", async () => {
    const beforeReady = pageSession("child-before", "child-before-frame");
    const main = pageSession("main");
    const page = new Page(
      {} as never,
      main as never,
      "page-target",
      "main-frame",
      {} as never,
      false,
      true,
    );
    page.adoptOopifSession(beforeReady as never, "child-before-frame");
    await vi.waitFor(() => expect(beforeReady.send).toHaveBeenCalledWith("Page.getFrameTree"));
    expect(beforeReady.send).not.toHaveBeenCalledWith("Page.enable");

    await page.prepareForInitialization();
    expect(beforeReady.send).toHaveBeenCalledWith("Page.enable");
    expect(beforeReady.send).toHaveBeenCalledWith("Runtime.enable");

    const afterReady = pageSession("child-after", "child-after-frame");
    page.adoptOopifSession(afterReady as never, "child-after-frame");
    await vi.waitFor(() =>
      expect(afterReady.send).toHaveBeenCalledWith("Page.setLifecycleEventsEnabled", {
        enabled: true,
      }),
    );
    expect(afterReady.send).toHaveBeenCalledWith("Page.enable");
    expect(afterReady.send).toHaveBeenCalledWith("Runtime.enable");

    const ordinaryChild = pageSession("ordinary-child", "ordinary-frame");
    const ordinaryPage = new Page(
      {} as never,
      pageSession("ordinary-main") as never,
      "ordinary-page",
      "ordinary-main-frame",
      {} as never,
    );
    ordinaryPage.adoptOopifSession(ordinaryChild as never, "ordinary-frame");
    await vi.waitFor(() => expect(ordinaryChild.send).toHaveBeenCalledWith("Page.getFrameTree"));
    expect(ordinaryChild.send).toHaveBeenCalledWith("Page.enable");
    expect(ordinaryChild.send).not.toHaveBeenCalledWith("Runtime.enable");
  });

  it("retries a child whose late adoption failed on the next preparation call", async () => {
    const main = pageSession("main");
    const page = new Page(
      {} as never,
      main as never,
      "page-target",
      "main-frame",
      {} as never,
      false,
      true,
    );
    await page.prepareForInitialization();
    expect(page.isInstrumentationReady()).toBe(true);

    let runtimeEnableAttempts = 0;
    const child = pageSession("child", "child-frame");
    child.send.mockImplementation(async (method: string) => {
      if (method === "Runtime.enable" && runtimeEnableAttempts++ === 0) {
        throw new Error("transient Runtime.enable failure");
      }
      if (method === "Page.getFrameTree") {
        return { frameTree: { frame: { id: "child-frame", url: "https://example.com" } } };
      }
      return {};
    });
    page.adoptOopifSession(child as never, "child-frame");
    await vi.waitFor(() => expect(child.send).toHaveBeenCalledWith("Page.getFrameTree"));
    expect(runtimeEnableAttempts).toBe(1);

    await page.prepareForInitialization();
    expect(runtimeEnableAttempts).toBe(2);
    expect(child.send).toHaveBeenCalledWith("Page.setLifecycleEventsEnabled", { enabled: true });

    const ordinaryMain = pageSession("ordinary-main");
    const ordinaryPage = new Page(
      {} as never,
      ordinaryMain as never,
      "ordinary-page",
      "ordinary-main-frame",
      {} as never,
    );
    ordinaryMain.send.mockClear();
    await ordinaryPage.prepareForInitialization();
    expect(ordinaryMain.send).not.toHaveBeenCalled();
  });

  it("tolerates a page closing during deferred context instrumentation", async () => {
    let rejectPreparation: ((error: Error) => void) | undefined;
    const page = {
      isInstrumentationReady: () => false,
      prepareForInitialization: () =>
        new Promise<void>((_resolve, reject) => {
          rejectPreparation = reject;
        }),
    };
    const context = new BrowserContext(
      {} as never,
      {} as never,
      chromeTabs,
      "LOCAL",
      null,
      "about:blank",
      null,
      { deferPageInstrumentation: true },
    );
    context.pagesByTarget.set("closing-page", page as never);
    context.typeByTarget.set("closing-page", "page");

    const preparation = context.prepareForInitialization();
    await vi.waitFor(() => expect(rejectPreparation).toBeDefined());
    context.pagesByTarget.delete("closing-page");
    rejectPreparation?.(new Error("target closed"));

    await expect(preparation).resolves.toBeUndefined();
  });

  it("instruments a page whose attach finishes after context preparation", async () => {
    let resolveA: (() => void) | undefined;
    let readyA = false;
    const pageA = {
      isInstrumentationReady: () => readyA,
      prepareForInitialization: () =>
        new Promise<void>((resolve) => {
          resolveA = () => {
            readyA = true;
            resolve();
          };
        }),
    };
    let resolveFrameTree: (() => void) | undefined;
    const sessionB = pageSession("session-b", "main-b");
    sessionB.send.mockImplementation(async (method: string) => {
      if (method === "Page.getFrameTree") {
        await new Promise<void>((resolve) => {
          resolveFrameTree = resolve;
        });
        return { frameTree: { frame: { id: "main-b", url: "https://example.com" } } };
      }
      return {};
    });
    const context = new BrowserContext(
      {
        getSession: vi.fn(() => sessionB),
        waitForSessionDispatch: vi.fn(async () => {}),
        send: vi.fn(async () => ({})),
      } as never,
      { debug: vi.fn() } as never,
      chromeTabs,
      "LOCAL",
      null,
      "about:blank",
      null,
      { deferPageInstrumentation: true },
    );
    context.pagesByTarget.set("A", pageA as never);
    context.typeByTarget.set("A", "page");

    const preparation = context.prepareForInitialization();
    await vi.waitFor(() => expect(resolveA).toBeDefined());
    const attaching = context.onAttachedToTarget(
      target("B", "page", "https://example.com"),
      "session-b",
    );
    await vi.waitFor(() => expect(resolveFrameTree).toBeDefined());
    expect(sessionB.send).not.toHaveBeenCalledWith("Page.enable", undefined);
    expect(sessionB.send).not.toHaveBeenCalledWith("Runtime.enable", undefined);

    resolveA?.();
    await preparation;
    resolveFrameTree?.();
    await attaching;

    expect(sessionB.send).toHaveBeenCalledWith("Page.enable");
    expect(sessionB.send).toHaveBeenCalledWith("Runtime.enable");
    expect(sessionB.send).toHaveBeenCalledWith("Page.setLifecycleEventsEnabled", {
      enabled: true,
    });
    expect(context.pagesByTarget.get("B")?.isInstrumentationReady()).toBe(true);
  });
});
