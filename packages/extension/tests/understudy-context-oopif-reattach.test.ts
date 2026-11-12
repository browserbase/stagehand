import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Protocol } from "devtools-protocol";
import type { ChromeTabTargetController } from "../understudy/chromeTabs.ts";
import type { CdpConnection, CDPSessionLike } from "../understudy/cdp.ts";
import { BrowserContext } from "../understudy/context.ts";
import { executionContexts } from "../understudy/executionContextRegistry.ts";
import type { Page } from "../understudy/page.ts";

function createSession(id: string, frame: Protocol.Page.Frame): CDPSessionLike {
  return {
    id,
    on: vi.fn(),
    off: vi.fn(),
    send: vi.fn(async (method: string) =>
      method === "Page.getFrameTree" ? { frameTree: { frame } } : {},
    ),
  } as unknown as CDPSessionLike;
}

// A Page stub that only tracks frame ids, so tests can see where an OOPIF was linked.
function createPage(mainFrameId: string) {
  const frames = new Map<string, string | null>([[mainFrameId, null]]);
  const page = {
    mainFrameId: () => mainFrameId,
    listAllFrameIds: () => [...frames.keys()],
    asProtocolFrameTree: () => ({ frame: { id: mainFrameId } }),
    onFrameAttached: vi.fn((frameId: string, parentId: string | null) => {
      frames.set(frameId, parentId);
    }),
    adoptOopifSession: vi.fn((_session: CDPSessionLike, frameId: string) => {
      if (!frames.has(frameId)) frames.set(frameId, null);
    }),
  };
  return { page: page as unknown as Page, stub: page, frames };
}

function createContext(sessions: CDPSessionLike[]) {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const connection = {
    on: vi.fn(),
    getSession: (id: string) => byId.get(id),
    waitForSessionDispatch: vi.fn(async () => {}),
  } as unknown as CdpConnection;
  const chromeTabs = {} as ChromeTabTargetController;
  return new BrowserContext(connection, { debug: vi.fn() } as never, chromeTabs);
}

function iframeTarget(targetId: string, parentFrameId: string): Protocol.Target.TargetInfo {
  return {
    targetId,
    type: "iframe",
    title: "",
    url: "https://example.com/",
    attached: true,
    canAccessOpener: false,
    parentFrameId,
  };
}

describe("BrowserContext OOPIFs that exist before attach", () => {
  beforeEach(() => {
    vi.spyOn(executionContexts, "attachSession").mockImplementation(() => {});
    vi.spyOn(executionContexts, "waitForMainWorld").mockResolvedValue(1);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("links a pre-existing OOPIF to its parent frame on attach", async () => {
    const child = createSession("child-session", {
      id: "child-frame",
      parentId: "main-frame",
    } as never);
    const context = createContext([child]);
    const { page, stub, frames } = createPage("main-frame");
    context.pagesByTarget.set("page-target", page);
    context.preexistingIframeTargets.add("child-target");

    await context.onAttachedToTarget(iframeTarget("child-target", "main-frame"), "child-session");

    expect(frames.get("child-frame")).toBe("main-frame");
    expect(stub.adoptOopifSession).toHaveBeenCalledWith(child, "child-frame");
    expect(context.sessionOwnerPage.get("child-session")).toBe(page);
    expect(context.pendingOopifByMainFrame.size).toBe(0);
  });

  it("stages a new OOPIF until its parent emits Page.frameAttached", async () => {
    const child = createSession("child-session", {
      id: "child-frame",
      parentId: "main-frame",
    } as never);
    const context = createContext([child]);
    const { page, stub } = createPage("main-frame");
    context.pagesByTarget.set("page-target", page);

    await context.onAttachedToTarget(iframeTarget("child-target", "main-frame"), "child-session");

    expect(stub.adoptOopifSession).not.toHaveBeenCalled();
    expect(context.pendingOopifByMainFrame.get("child-frame")).toBe("child-session");
    expect(context.pendingOopifParentByMainFrame.has("child-frame")).toBe(false);
  });

  it("adopts staged pre-existing OOPIFs when their parent Page registers, including nested ones", () => {
    const outer = createSession("outer-session", { id: "outer-frame" } as never);
    const inner = createSession("inner-session", { id: "inner-frame" } as never);
    const context = createContext([outer, inner]);
    // The inner frame's parent is the outer OOPIF, which is also not linked yet.
    context.pendingOopifByMainFrame.set("inner-frame", "inner-session");
    context.pendingOopifParentByMainFrame.set("inner-frame", "outer-frame");
    context.pendingOopifByMainFrame.set("outer-frame", "outer-session");
    context.pendingOopifParentByMainFrame.set("outer-frame", "main-frame");

    const { page, frames } = createPage("main-frame");
    context.pagesByTarget.set("page-target", page);
    context.adoptPendingOopifs();

    expect(frames.get("outer-frame")).toBe("main-frame");
    expect(frames.get("inner-frame")).toBe("outer-frame");
    expect(context.sessionOwnerPage.get("outer-session")).toBe(page);
    expect(context.sessionOwnerPage.get("inner-session")).toBe(page);
    expect(context.pendingOopifByMainFrame.size).toBe(0);
    expect(context.pendingOopifParentByMainFrame.size).toBe(0);
  });
});
