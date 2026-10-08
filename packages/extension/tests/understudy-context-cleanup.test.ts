import { describe, expect, it, vi } from "vitest";
import type { StagehandLogger } from "../logger.js";
import type { CDPSessionLike, CdpConnection } from "../understudy/cdp.js";
import { BrowserContext } from "../understudy/context.js";
import { Page } from "../understudy/page.js";

class FakeSession implements CDPSessionLike {
  readonly handlers = new Map<string, Set<(params: unknown) => void>>();

  constructor(readonly id: string) {}

  async send<Result = unknown>(): Promise<Result> {
    return {} as Result;
  }

  on<Params = unknown>(event: string, handler: (params: Params) => void): void {
    const handlers = this.handlers.get(event) ?? new Set();
    handlers.add(handler as (params: unknown) => void);
    this.handlers.set(event, handlers);
  }

  off<Params = unknown>(event: string, handler: (params: Params) => void): void {
    this.handlers.get(event)?.delete(handler as (params: unknown) => void);
  }

  emit(event: string, params: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) handler(params);
  }

  async close(): Promise<void> {}
}

function createContext() {
  const sessions = new Map<string, FakeSession>();
  const close = vi.fn(async () => {});
  const conn = { getSession: (id: string) => sessions.get(id), close } as unknown as CdpConnection;
  const logger = {} as StagehandLogger;
  const context = new BrowserContext(conn, logger, {} as never);

  const addPage = (targetId: string) => {
    const session = new FakeSession(targetId);
    sessions.set(session.id, session);
    const page = new Page(conn, session, targetId, `${targetId}-main`, logger);
    context.pagesByTarget.set(targetId, page);
    context.typeByTarget.set(targetId, "page");
    context.mainFrameToTarget.set(page.mainFrameId(), targetId);
    context.sessionOwnerPage.set(session.id, page);
    context.frameOwnerPage.set(page.mainFrameId(), page);
    context.installFrameEventBridges(session.id, page);
    session.emit("Page.frameAttached", {
      frameId: `${targetId}-child`,
      parentFrameId: page.mainFrameId(),
    });
    session.emit("Page.frameAttached", {
      frameId: `${targetId}-grandchild`,
      parentFrameId: `${targetId}-child`,
    });
    page.frameForId(`${targetId}-child`);
    page.frameForId(`${targetId}-grandchild`);
    return { page, session };
  };

  return { context, sessions, close, addPage };
}

function seedShutdownBookkeeping(context: BrowserContext): void {
  context._targetSessionListeners.add("page");
  context._domainPolicySessionListeners.set("page", () => {});
  context._sessionInit.add("page");
  context.pendingOopifByMainFrame.set("frame", "child");
  context.createdAtByTarget.set("page", Date.now());
  context.pendingCreatedTargetUrl.set("page", "about:blank");
  context.pageCreationFailures.set("pending", new Error("creation failed"));
  context.pendingInitialTopLevelTargets.add("initial");
  context.pendingNewPageTargets.add("pending");
  context.domainPolicyClosingTargets.add("blocked");
  context.domainPolicyClosePromises.set("blocked", Promise.resolve(true));
}

function expectContextCleared(context: BrowserContext): void {
  for (const collection of [
    context._targetSessionListeners,
    context._domainPolicySessionListeners,
    context._sessionInit,
    context.pagesByTarget,
    context.mainFrameToTarget,
    context.sessionOwnerPage,
    context.frameOwnerPage,
    context.pendingOopifByMainFrame,
    context.createdAtByTarget,
    context.typeByTarget,
    context.pendingCreatedTargetUrl,
    context.pageCreationFailures,
    context.pendingInitialTopLevelTargets,
    context.pendingNewPageTargets,
    context.domainPolicyClosingTargets,
    context.domainPolicyClosePromises,
  ]) {
    expect(collection.size).toBe(0);
  }
}

describe("BrowserContext frame cleanup", () => {
  it("releases every frame owner when pages close across a reused context", () => {
    const { context, addPage } = createContext();
    const { page: retainedPage } = addPage("retained");

    for (let index = 0; index < 100; index++) {
      const targetId = `page-${index}`;
      addPage(targetId);
      context.cleanupByTarget(targetId);
    }

    expect([...context.frameOwnerPage.values()]).toEqual([
      retainedPage,
      retainedPage,
      retainedPage,
    ]);
    expect(context.pagesByTarget.size).toBe(1);
    retainedPage.dispose();
  });

  it("drops removed subtree owners, cached frames, and ordinals", () => {
    const { context, addPage } = createContext();
    const { page, session } = addPage("page");

    session.emit("Page.frameDetached", { frameId: "page-child", reason: "remove" });

    expect([...context.frameOwnerPage.keys()]).toEqual(["page-main"]);
    expect(page.frameCache.size).toBe(0);
    expect(page.frameOrdinals.size).toBe(0);
    expect([...page.registry.frames.keys()]).toEqual(["page-main"]);
    page.dispose();
  });

  it("preserves subtree owners and ordinals on process swaps", () => {
    const { context, addPage } = createContext();
    const { page, session } = addPage("page");
    const ordinal = page.getOrdinal("page-child");

    session.emit("Page.frameDetached", { frameId: "page-child", reason: "swap" });

    expect(context.frameOwnerPage.size).toBe(3);
    expect(page.getOrdinal("page-child")).toBe(ordinal);
    expect(page.frameCache.has("page-grandchild")).toBe(true);
    page.dispose();
  });

  it("drops subtree owners even when another bridge already removed the frames", () => {
    const { context, addPage } = createContext();
    const { page, session } = addPage("page");
    page.onFrameDetached("page-child");

    session.emit("Page.frameDetached", { frameId: "page-child", reason: "remove" });

    expect([...context.frameOwnerPage.keys()]).toEqual(["page-main"]);
    page.dispose();
  });

  it("releases subtree owners when an OOPIF session detaches", () => {
    const { context, sessions, addPage } = createContext();
    const { page } = addPage("page");
    const child = new FakeSession("oopif");
    sessions.set(child.id, child);
    page.adoptOopifSession(child, "page-child");
    context.sessionOwnerPage.set(child.id, page);

    context.onDetachedFromTarget(child.id, "iframe-target");

    expect([...context.frameOwnerPage.keys()]).toEqual(["page-main"]);
    expect(page.frameCache.size).toBe(0);
    expect(page.frameOrdinals.size).toBe(0);
    page.dispose();
  });

  it("disposes page listeners before closing the connection", async () => {
    const { context, close, addPage } = createContext();
    const { session } = addPage("page");
    context._targetSessionListeners.add(session.id);
    context._sessionInit.add(session.id);
    context._domainPolicySessionListeners.set(session.id, () => {});
    close.mockImplementation(async () => {
      expect(session.handlers.get("Network.requestWillBeSent")?.size).toBe(0);
    });

    await context.close();

    expect(context.pagesByTarget.size).toBe(0);
    expect(context.frameOwnerPage.size).toBe(0);
    expect(context._targetSessionListeners.size).toBe(0);
    expect(context._sessionInit.size).toBe(0);
    expect(context._domainPolicySessionListeners.size).toBe(0);
  });

  it("disposes remaining pages and closes CDP after a page disposer throws", async () => {
    const { context, close, addPage } = createContext();
    const { page: first } = addPage("first");
    const { page: second, session } = addPage("second");
    seedShutdownBookkeeping(context);
    const error = new Error("page disposal failed");
    const failingDispose = vi.spyOn(first, "dispose").mockImplementation(() => {
      throw error;
    });
    const secondDispose = vi.spyOn(second, "dispose");
    close.mockImplementation(async () => {
      expect(secondDispose).toHaveBeenCalledOnce();
      expect(session.handlers.get("Network.requestWillBeSent")?.size).toBe(0);
    });

    await expect(context.close()).rejects.toBe(error);

    expect(close).toHaveBeenCalledOnce();
    expectContextCleared(context);
    failingDispose.mockRestore();
    first.dispose();
  });

  it("clears all bookkeeping when closing CDP rejects", async () => {
    const { context, close, addPage } = createContext();
    const { session } = addPage("page");
    seedShutdownBookkeeping(context);
    const error = new Error("CDP shutdown failed");
    close.mockRejectedValue(error);

    await expect(context.close()).rejects.toBe(error);

    expect(session.handlers.get("Network.requestWillBeSent")?.size).toBe(0);
    expectContextCleared(context);
  });

  it("disposes pages removed from the context by another disposer", async () => {
    const { context, addPage } = createContext();
    const { page: first } = addPage("first");
    const { page: second, session } = addPage("second");
    const disposeFirst = first.dispose.bind(first);
    vi.spyOn(first, "dispose").mockImplementation(() => {
      disposeFirst();
      context.pagesByTarget.delete("second");
    });
    const secondDispose = vi.spyOn(second, "dispose");

    await context.close();

    expect(secondDispose).toHaveBeenCalledOnce();
    expect(session.handlers.get("Network.requestWillBeSent")?.size).toBe(0);
    expectContextCleared(context);
  });

  it("reports every disposal and connection failure after clearing bookkeeping", async () => {
    const { context, close, addPage } = createContext();
    const { page: first } = addPage("first");
    const { page: second } = addPage("second");
    seedShutdownBookkeeping(context);
    const errors = [new Error("first page"), new Error("second page"), new Error("CDP")];
    const firstDispose = vi.spyOn(first, "dispose").mockImplementation(() => {
      throw errors[0];
    });
    const secondDispose = vi.spyOn(second, "dispose").mockImplementation(() => {
      throw errors[1];
    });
    close.mockRejectedValue(errors[2]);

    await expect(context.close()).rejects.toMatchObject({
      name: "AggregateError",
      message: "Failed to close browser context",
      errors,
    });

    expect(firstDispose).toHaveBeenCalledOnce();
    expect(secondDispose).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expectContextCleared(context);
    firstDispose.mockRestore();
    secondDispose.mockRestore();
    first.dispose();
    second.dispose();
  });
});
