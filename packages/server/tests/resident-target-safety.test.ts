import type { Protocol } from "devtools-protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChromeTabTargetController } from "../understudy/chromeTabs.js";
import { V3Context, isSupportedWebTarget } from "../understudy/context.js";
import { CdpConnection, STAGEHAND_WEB_TARGET_FILTER } from "../understudy/cdp.js";
import { Page } from "../understudy/page.js";

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

describe("resident target attachment safety", () => {
  afterEach(() => vi.restoreAllMocks());

  it("allowlists page and injectable iframe targets", () => {
    expect(isSupportedWebTarget(target("page", "page", "about:blank"))).toBe(true);
    expect(isSupportedWebTarget(target("internal", "page", "chrome://newtab"))).toBe(false);
    expect(
      isSupportedWebTarget(target("other-extension", "page", "chrome-extension://other")),
    ).toBe(false);
    expect(isSupportedWebTarget(target("iframe", "iframe", "https://example.com/frame"))).toBe(
      true,
    );
    expect(isSupportedWebTarget(target("extension", "iframe", "chrome-extension://other"))).toBe(
      false,
    );
    for (const type of [
      "browser",
      "service_worker",
      "worker",
      "shared_worker",
      "background_page",
    ]) {
      expect(isSupportedWebTarget(target(type, type, "https://example.com"))).toBe(false);
    }
  });

  it("filters the initial sweep before manually attaching", async () => {
    const attachToTarget = vi.fn(async () => ({}));
    const context = new V3Context(
      {
        on: vi.fn(),
        enableAutoAttach: vi.fn(async () => {}),
        getTargets: vi.fn(async () => [
          target("page", "page", "about:blank"),
          target("iframe", "iframe", "https://example.com/frame"),
          target("worker", "worker", "https://example.com/worker.js"),
          target("stagehand-worker", "service_worker", "chrome-extension://stagehand/sw.js"),
          target("background", "background_page", "chrome-extension://other/background.html"),
        ]),
        attachToTarget,
      } as never,
      {} as never,
      chromeTabs,
    );
    vi.spyOn(context, "waitForInitialTopLevelTargets").mockResolvedValue();

    await context.bootstrap();

    expect(attachToTarget.mock.calls).toStrictEqual([["page"], ["iframe"]]);
  });

  it("uses the restricted filter for future root auto-attachment", async () => {
    const send = vi.fn(async () => ({}));
    const connection = new CdpConnection(
      {
        connected: true,
        send: vi.fn(),
        close: vi.fn(async () => {}),
        onMessage: vi.fn(),
        onClose: vi.fn(),
        onError: vi.fn(),
      },
      { debug: () => {}, error: () => {} },
    );
    vi.spyOn(connection, "send").mockImplementation(send);

    await connection.enableAutoAttach();

    expect(send).toHaveBeenNthCalledWith(1, "Target.setAutoAttach", {
      autoAttach: true,
      flatten: true,
      waitForDebuggerOnStart: true,
      filter: STAGEHAND_WEB_TARGET_FILTER,
    });
  });

  it("resumes and detaches an ignored target that arrives paused", async () => {
    const send = vi.fn(async () => ({}));
    const close = vi.fn(async () => {});
    const context = new V3Context(
      {
        getSession: vi.fn(() => ({ send, close })),
      } as never,
      {} as never,
      chromeTabs,
    );

    await context.onAttachedToTarget(
      target("worker", "worker", "https://example.com/worker.js"),
      "session-worker",
    );

    expect(send).toHaveBeenCalledWith("Runtime.runIfWaitingForDebugger");
    expect(close).toHaveBeenCalledOnce();
  });

  it("does not create a blank page during resident V3Context bootstrap", async () => {
    const connection = {
      connected: true,
      onTransportClosed: vi.fn(),
      close: vi.fn(async () => {}),
    } as unknown as CdpConnection;
    vi.spyOn(CdpConnection, "connect").mockResolvedValue(connection);
    vi.spyOn(V3Context.prototype, "bootstrap").mockResolvedValue();
    const ensureFirstTopLevelPage = vi
      .spyOn(V3Context.prototype, "ensureFirstTopLevelPage")
      .mockResolvedValue();

    await V3Context.create("ws://pid2.test", {
      websocketFactory: vi.fn(),
      blankPageUrl: "chrome-extension://stagehand/blank.html",
      fallbackLocatorScriptSource: "",
      chromeTabs,
      logger: {} as never,
      ensureInitialPage: false,
    });

    expect(ensureFirstTopLevelPage).not.toHaveBeenCalled();
  });

  it("defers page and network instrumentation until Stagehand initialization", async () => {
    const send = vi.fn(async () => ({}));
    const session = {
      id: "page-session",
      send,
      on: vi.fn(),
      off: vi.fn(),
    };
    const page = new Page(
      {} as never,
      session as never,
      "page-target",
      "main-frame",
      {} as never,
      null,
      true,
      true,
    );

    expect(send).not.toHaveBeenCalled();
    await page.prepareForInitialization();

    expect(send).toHaveBeenCalledWith("Page.enable");
    expect(send).toHaveBeenCalledWith("Runtime.enable");
    expect(send).toHaveBeenCalledWith("Network.enable");
  });
});
