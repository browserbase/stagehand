import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChromeTabTargetController } from "../understudy/chromeTabs.ts";
import { CdpConnection } from "../understudy/cdp.ts";
import { V3Context } from "../understudy/context.ts";
import type { Page } from "../understudy/page.ts";

function createPage(targetId: string): Page {
  return {
    targetId: () => targetId,
    mainFrameWrapper: {
      getExtensionWorldExecutionContextId: vi.fn(async () => 1),
    },
  } as unknown as Page;
}

function createContext() {
  const connectionState = {
    connected: true,
    send: vi.fn(async (method: string) =>
      method === "Target.createTarget" ? { targetId: "created-target" } : {},
    ),
  };
  const connection = connectionState as unknown as CdpConnection;
  const chromeTabs: ChromeTabTargetController = {
    activeTargetId: vi.fn(async () => undefined),
    targetIdForTabId: vi.fn(async () => undefined),
    tabIdForTargetId: vi.fn(async () => undefined),
    activateTarget: vi.fn(async () => {}),
  };
  const logger = { debug: vi.fn() };
  return {
    connection,
    connectionState,
    context: new V3Context(connection, logger as never, chromeTabs),
    chromeTabs,
    logger,
  };
}

function createOptions() {
  const { chromeTabs, logger } = createContext();
  return {
    websocketFactory: vi.fn() as never,
    blankPageUrl: "about:blank",
    fallbackLocatorScriptSource: "",
    chromeTabs,
    logger: logger as never,
  };
}

describe("V3Context first top-level page", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("keeps an existing top-level page without creating a fallback", async () => {
    vi.spyOn(CdpConnection, "connect").mockResolvedValue({ connected: true } as CdpConnection);
    vi.spyOn(V3Context.prototype, "bootstrap").mockImplementation(async function () {
      this.typeByTarget.set("page-target", "page");
      this.pagesByTarget.set("page-target", createPage("page-target"));
    });
    const newPage = vi
      .spyOn(V3Context.prototype, "newPage")
      .mockResolvedValue(createPage("fallback-target"));

    await V3Context.create("ws://cdp.test", createOptions());

    expect(newPage).not.toHaveBeenCalled();
  });

  it("creates the blank fallback immediately when bootstrap reports no page", async () => {
    vi.spyOn(CdpConnection, "connect").mockResolvedValue({ connected: true } as CdpConnection);
    vi.spyOn(V3Context.prototype, "bootstrap").mockResolvedValue();
    const newPage = vi
      .spyOn(V3Context.prototype, "newPage")
      .mockResolvedValue(createPage("fallback-target"));

    await V3Context.create("ws://cdp.test", createOptions());

    expect(newPage).toHaveBeenCalledOnce();
    expect(newPage).toHaveBeenCalledWith();
  });

  it("waits for a reported top-level target to register without a separate deadline", async () => {
    const { context } = createContext();
    const waiting = context.waitForInitialTopLevelTargets(["page-target"]);
    setTimeout(() => context.pagesByTarget.set("page-target", createPage("page-target")), 10_000);

    await vi.advanceTimersByTimeAsync(10_000);

    await expect(waiting).resolves.toBeUndefined();
  });

  it("waits beyond ten seconds for a newly created page to register", async () => {
    const { context } = createContext();
    const waiting = context.newPage();
    setTimeout(
      () => context.pagesByTarget.set("created-target", createPage("created-target")),
      10_001,
    );

    await vi.advanceTimersByTimeAsync(10_026);

    await expect(waiting).resolves.toMatchObject({
      targetId: expect.any(Function),
    });
  });

  it("stops waiting for target registration when the CDP lifecycle closes", async () => {
    const { connectionState, context } = createContext();
    const waiting = expect(context.waitForInitialTopLevelTargets(["page-target"])).rejects.toThrow(
      "CDP connection closed while waiting for initial top-level targets: page-target",
    );
    connectionState.connected = false;

    await vi.advanceTimersByTimeAsync(25);

    await waiting;
  });
});
