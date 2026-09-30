import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FrameContext, FrameDomMaps, SessionDomIndex } from "../../../types/private/index.js";
import type { StagehandLogger } from "../../../logger.js";
import { Page } from "../../page.js";
import { Progress } from "../../progress.js";
import { FrameSelectorResolver } from "../../selectorResolver.js";
import { a11yForFrame } from "./a11yTree.js";
import {
  buildFrameExclusionIntervals,
  collectPerFrameMaps,
  mergeFramesIntoSnapshot,
  resolveIgnoredNodes,
  tryScopedSnapshot,
} from "./capture.js";
import { domMapsForSession } from "./domTree.js";
import * as focusSelectors from "./focusSelectors.js";
import { resolveCssFocusFrameAndTail } from "./focusSelectors.js";
import { ownerSession, parentSession } from "./sessions.js";

vi.mock("./a11yTree.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./a11yTree.js")>()),
  a11yForFrame: vi.fn(),
}));
vi.mock("./domTree.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./domTree.js")>()),
  domMapsForSession: vi.fn(),
}));
vi.mock("./focusSelectors.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./focusSelectors.js")>()),
  resolveCssFocusFrameAndTail: vi.fn(),
}));
vi.mock("./sessions.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./sessions.js")>()),
  ownerSession: vi.fn(),
  parentSession: vi.fn(),
}));

const emptyMaps = (): FrameDomMaps => ({
  tagNameMap: {},
  xpathMap: {},
  scrollableMap: {},
  urlMap: {},
});

describe("snapshot frame document slicing", () => {
  const documentIndex = (rootBackend = 1): SessionDomIndex => ({
    rootBackend,
    absByBe: new Map([
      [rootBackend, "/"],
      [rootBackend + 1, "/html[1]"],
      [rootBackend + 2, "/html[1]/body[1]"],
    ]),
    tagByBe: new Map(),
    scrollByBe: new Map(),
    docRootOf: new Map([
      [rootBackend, rootBackend],
      [rootBackend + 1, rootBackend],
      [rootBackend + 2, rootBackend],
    ]),
    contentDocRootByIframe: new Map(),
    enterByBe: new Map(),
    exitByBe: new Map(),
  });

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(a11yForFrame).mockResolvedValue({
      outline: "[0-3] button: Root",
      urlMap: {},
      scopeApplied: false,
    });
  });

  it.each(["owner lookup fails", "owner is missing", "content document is missing"])(
    "does not duplicate the parent map when a same-session child's %s",
    async (failure) => {
      const session = {
        id: "root-session",
        send: vi.fn(async () => {
          if (failure === "owner lookup fails") throw new Error("No frame owner found");
          return failure === "owner is missing" ? {} : { backendNodeId: 4 };
        }),
      };
      vi.mocked(ownerSession).mockReturnValue(session as never);
      const context: FrameContext = {
        rootId: "root",
        frames: ["root", "child-a", "child-b"],
        parentByFrame: new Map([
          ["root", null],
          ["child-a", "root"],
          ["child-b", "root"],
        ]),
      };
      const page = { getOrdinal: (id: string) => context.frames.indexOf(id) } as Page;
      const { perFrameMaps, perFrameOutlines } = await collectPerFrameMaps(
        page,
        context,
        new Map([[session.id, documentIndex()]]),
        undefined,
        true,
        context.frames,
        new Map(),
      );
      const snapshot = mergeFramesIntoSnapshot(
        context,
        perFrameMaps,
        perFrameOutlines,
        new Map([["root", ""]]),
        new Map(),
        context.frames,
      );

      expect(snapshot.combinedTree).toBe("[0-3] button: Root");
      expect(snapshot.combinedXpathMap).toEqual({
        "0-1": "/",
        "0-2": "/html[1]",
        "0-3": "/html[1]/body[1]",
      });
      expect([...perFrameMaps.keys()]).toEqual(["root"]);
      expect(a11yForFrame).toHaveBeenCalledTimes(1);
    },
  );

  it("does not resolve an ignored child document to the parent document", async () => {
    const session = { id: "root-session", send: vi.fn().mockResolvedValue({ backendNodeId: 4 }) };
    vi.mocked(ownerSession).mockReturnValue(session as never);
    const focus = vi
      .spyOn(focusSelectors, "resolveFocusFrameAndTail")
      .mockResolvedValue({ targetFrameId: "child", tailXPath: "/" } as never);
    const context: FrameContext = {
      rootId: "root",
      frames: ["root", "child"],
      parentByFrame: new Map([
        ["root", null],
        ["child", "root"],
      ]),
    };
    try {
      const ignored = await resolveIgnoredNodes(
        {} as Page,
        [{ selector: "xpath=/iframe/" }],
        context,
        new Map([[session.id, documentIndex()]]),
      );
      expect(ignored.size).toBe(0);
    } finally {
      focus.mockRestore();
    }
  });

  it("does not give an unresolved excluded child the parent's whole interval", async () => {
    const session = { id: "root-session", send: vi.fn().mockResolvedValue({ backendNodeId: 4 }) };
    vi.mocked(ownerSession).mockReturnValue(session as never);
    vi.mocked(parentSession).mockReturnValue(session as never);
    const context: FrameContext = {
      rootId: "root",
      frames: ["root", "child"],
      parentByFrame: new Map([
        ["root", null],
        ["child", "root"],
      ]),
    };
    const index = documentIndex();
    index.enterByBe.set(1, 1);
    index.exitByBe.set(1, 100);
    index.enterByBe.set(4, 10);
    index.exitByBe.set(4, 20);
    const intervals = await buildFrameExclusionIntervals(
      {} as Page,
      context,
      new Map([[session.id, index]]),
      new Map([["root", new Set([4])]]),
    );
    expect(intervals.get("root")).toEqual([{ start: 10, end: 20 }]);
    expect(intervals.has("child")).toBe(false);
  });

  it("retains root and OOPIF session roots and slices a resolved same-session child", async () => {
    const rootSession = {
      id: "root-session",
      send: vi.fn().mockResolvedValue({ backendNodeId: 4 }),
    };
    const oopifSession = { id: "oopif-session", send: vi.fn() };
    vi.mocked(ownerSession).mockImplementation(
      (_page, id) => (id === "oopif" ? oopifSession : rootSession) as never,
    );
    const context: FrameContext = {
      rootId: "root",
      frames: ["root", "child", "oopif"],
      parentByFrame: new Map([
        ["root", null],
        ["child", "root"],
        ["oopif", "root"],
      ]),
    };
    const rootIndex = documentIndex();
    rootIndex.contentDocRootByIframe.set(4, 10);
    rootIndex.absByBe.set(10, "/html[1]/body[1]/iframe[1]");
    rootIndex.absByBe.set(11, "/html[1]/body[1]/iframe[1]/html[1]");
    rootIndex.docRootOf.set(10, 10);
    rootIndex.docRootOf.set(11, 10);
    const { perFrameMaps } = await collectPerFrameMaps(
      { getOrdinal: (id: string) => context.frames.indexOf(id) } as Page,
      context,
      new Map([
        [rootSession.id, rootIndex],
        [oopifSession.id, documentIndex(20)],
      ]),
      undefined,
      true,
      context.frames,
      new Map(),
    );

    expect(perFrameMaps.get("root")?.xpathMap).toEqual({
      "0-1": "/",
      "0-2": "/html[1]",
      "0-3": "/html[1]/body[1]",
    });
    expect(perFrameMaps.get("child")?.xpathMap).toEqual({ "1-10": "/", "1-11": "/html[1]" });
    expect(perFrameMaps.get("oopif")?.xpathMap).toEqual({
      "2-20": "/",
      "2-21": "/html[1]",
      "2-22": "/html[1]/body[1]",
    });
    expect(rootSession.send).toHaveBeenCalledExactlyOnceWith("DOM.getFrameOwner", {
      frameId: "child",
    });
    expect(oopifSession.send).not.toHaveBeenCalled();
    expect(a11yForFrame).toHaveBeenCalledTimes(3);
  });
});

describe("snapshot Unicode repair", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("repairs malformed Unicode in injected child outlines and per-frame output", () => {
    const context: FrameContext = {
      rootId: "root",
      frames: ["root", "child"],
      parentByFrame: new Map([
        ["root", null],
        ["child", "root"],
      ]),
    };
    const malformedChild = `[1-2] heading: Draw Again. ${String.fromCharCode(0xd83c)}`;

    const snapshot = mergeFramesIntoSnapshot(
      context,
      new Map([
        ["root", emptyMaps()],
        ["child", emptyMaps()],
      ]),
      [
        { frameId: "root", outline: "[0-1] iframe: Child" },
        { frameId: "child", outline: malformedChild },
      ],
      new Map([
        ["root", ""],
        ["child", "/html/body/iframe"],
      ]),
      new Map([["child", "0-1"]]),
      ["root", "child"],
    );

    expect(snapshot.combinedTree).toContain("Draw Again. �");
    expect((snapshot.combinedTree as string & { isWellFormed(): boolean }).isWellFormed()).toBe(
      true,
    );
    const child = snapshot.perFrame?.find((frame) => frame.frameId === "child");
    expect(child).toBeDefined();
    expect(child!.outline).toContain("Draw Again. �");
    expect((child!.outline as string & { isWellFormed(): boolean }).isWellFormed()).toBe(true);
  });

  it("repairs malformed Unicode in a successfully scoped snapshot", async () => {
    const malformedOutline = `[0-1] heading: Scoped ${String.fromCharCode(0xd83c)}`;
    vi.mocked(resolveCssFocusFrameAndTail).mockResolvedValue({
      targetFrameId: "root",
      tailSelector: "#target",
      absPrefix: "",
    });
    vi.mocked(ownerSession).mockReturnValue({ id: "root" } as never);
    vi.mocked(domMapsForSession).mockResolvedValue(emptyMaps());
    vi.mocked(a11yForFrame).mockResolvedValue({
      outline: malformedOutline,
      urlMap: {},
      scopeApplied: true,
    });

    const snapshot = await tryScopedSnapshot(
      {} as Page,
      { focusLocator: { selector: "#target", nth: 2 } },
      {
        rootId: "root",
        frames: ["root"],
        parentByFrame: new Map([["root", null]]),
      },
      true,
      new Map(),
      new Map(),
      { warn: vi.fn() } as unknown as StagehandLogger,
    );

    expect(snapshot).not.toBeNull();
    expect(snapshot!.combinedTree).toContain("Scoped �");
    expect((snapshot!.combinedTree as string & { isWellFormed(): boolean }).isWellFormed()).toBe(
      true,
    );
    expect(snapshot!.perFrame).toHaveLength(1);
    expect(snapshot!.perFrame![0]!.outline).toContain("Scoped �");
    expect(
      (snapshot!.perFrame![0]!.outline as string & { isWellFormed(): boolean }).isWellFormed(),
    ).toBe(true);
    expect(a11yForFrame).toHaveBeenCalledWith(
      expect.anything(),
      "root",
      expect.objectContaining({
        focusLocator: { selector: "#target", nth: 2 },
      }),
      undefined,
    );
  });

  it("resolves only the indexed ignored locator match", async () => {
    const session = {
      id: "root-session",
      send: vi.fn(async (method: string, params?: Record<string, unknown>) => {
        if (method === "DOM.describeNode" && params?.objectId === "object-second") {
          return { node: { backendNodeId: 20 } };
        }
        if (method === "Runtime.releaseObject") return {};
        throw new Error(`Unexpected method: ${method}`);
      }),
    };
    vi.mocked(resolveCssFocusFrameAndTail).mockResolvedValue({
      targetFrameId: "root",
      tailSelector: ".card",
      absPrefix: "",
    });
    vi.mocked(ownerSession).mockReturnValue(session as never);
    const resolveAtIndex = vi
      .spyOn(FrameSelectorResolver.prototype, "resolveAtIndex")
      .mockResolvedValue({ objectId: "object-second", nodeId: null });
    const resolveAll = vi.spyOn(FrameSelectorResolver.prototype, "resolveAll");

    try {
      const ignoredNodes = await resolveIgnoredNodes(
        { logger: {} } as Page,
        [{ selector: ".card", nth: 1 }],
        {
          rootId: "root",
          frames: ["root"],
          parentByFrame: new Map([["root", null]]),
        },
        new Map(),
      );

      expect(resolveAtIndex).toHaveBeenCalledWith({ kind: "css", value: ".card" }, 1, undefined);
      expect(resolveAll).not.toHaveBeenCalled();
      expect(ignoredNodes.get("root")).toEqual(new Set([20]));
      expect(session.send).toHaveBeenCalledWith("DOM.describeNode", { objectId: "object-second" });
    } finally {
      resolveAtIndex.mockRestore();
      resolveAll.mockRestore();
    }
  });
});

describe("snapshot progress ownership", () => {
  let page: Page;
  let progress: Progress;
  const root = { nodeId: 1, backendNodeId: 1, nodeName: "#document", children: [] };
  const send = vi.fn(async (_method: string, _params?: unknown): Promise<unknown> => ({ root }));
  const session = { id: "session", send };
  const warn = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    progress = new Progress("extract", 20);
    send.mockResolvedValue({ root });
    vi.mocked(ownerSession).mockReturnValue(session as never);
    vi.mocked(parentSession).mockReturnValue(session as never);
    vi.mocked(a11yForFrame).mockResolvedValue({ outline: "root", urlMap: {}, scopeApplied: false });
    vi.mocked(resolveCssFocusFrameAndTail).mockResolvedValue({
      targetFrameId: "root",
      tailSelector: ".card",
      absPrefix: "",
    });
    page = Object.assign(Object.create(Page.prototype) as Page, {
      logger: { warn },
      mainFrameId: () => "root",
      listAllFrameIds: () => ["root", "child"],
      asProtocolFrameTree: () => ({
        frame: { id: "root" },
        childFrames: [{ frame: { id: "child" } }],
      }),
      getOrdinal: (id: string) => (id === "root" ? 0 : 1),
    });
  });
  afterEach(() => {
    progress.dispose();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each(["snapshot", "captureSnapshot"] as const)(
    "%s uses its parent's remaining time",
    async (method) => {
      let respond!: (value: unknown) => void;
      send.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            respond = resolve;
          }),
      );
      await vi.advanceTimersByTimeAsync(10);
      const result =
        method === "snapshot"
          ? page.snapshot({ timeout: 1 }, progress)
          : page.captureSnapshot({}, progress);
      const timedOut = expect(result).rejects.toThrow(/extract timed out after 20ms/);
      await vi.advanceTimersByTimeAsync(10);
      await timedOut;
      await expect(result).rejects.toBe(progress.signal.reason);
      respond({ root });
      await vi.advanceTimersByTimeAsync(0);
      expect(send).toHaveBeenCalledTimes(1);
      expect(a11yForFrame).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, 0])("keeps standalone snapshot timeout %s unlimited", async (timeout) => {
    send.mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25_000));
      return {};
    });
    const result = page.snapshot({ includeIframes: false, timeout });
    await vi.advanceTimersByTimeAsync(25_000);
    await expect(result).resolves.toMatchObject({
      formattedTree: "root",
      xpathMap: { "0-1": "/" },
    });
    const received = vi.mocked(a11yForFrame).mock.calls[0]![3]!;
    expect(received).toBeInstanceOf(Progress);
    expect(received.remainingMs()).toBe(Infinity);
  });

  it("stops a public snapshot at its requested deadline", async () => {
    send.mockImplementationOnce(() => new Promise(() => {}));
    const result = page.snapshot({ timeout: 10 });
    const timedOut = expect(result).rejects.toThrow(/snapshot timed out after 10ms/);
    await vi.advanceTimersByTimeAsync(10);
    await timedOut;
    expect(send).toHaveBeenCalledTimes(1);
    expect(a11yForFrame).not.toHaveBeenCalled();
  });

  it("stops before reading another frame even if the deadline timer has not fired", async () => {
    vi.mocked(a11yForFrame).mockImplementationOnce(async (_session, _frame, _options, received) => {
      expect(received).toBe(progress);
      vi.spyOn(performance, "now").mockReturnValue(20);
      return { outline: "root", urlMap: {}, scopeApplied: false };
    });
    await expect(page.snapshot({}, progress)).rejects.toThrow(/extract timed out/);
    expect(a11yForFrame).toHaveBeenCalledTimes(1);
    expect(send.mock.calls.map(([method]) => method)).toEqual(["DOM.enable", "DOM.getDocument"]);
  });

  it("does not turn focus expiry into a full-page fallback", async () => {
    vi.mocked(resolveCssFocusFrameAndTail).mockImplementationOnce(
      async (_page, _selector, _parents, _root, received) => {
        expect(received).toBe(progress);
        vi.spyOn(performance, "now").mockReturnValue(20);
        throw new Error("focus unavailable");
      },
    );
    await expect(
      page.captureSnapshot({ focusLocator: { selector: ".card" } }, progress),
    ).rejects.toThrow(/extract timed out/);
    expect(warn).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("releases ignored-node references without continuing after expiry", async () => {
    const resolve = vi.spyOn(FrameSelectorResolver.prototype, "resolveAll").mockResolvedValue([
      { nodeId: null, objectId: "first" },
      { nodeId: null, objectId: "second" },
    ]);
    send.mockImplementation(async (method) => {
      if (method === "DOM.describeNode") {
        vi.spyOn(performance, "now").mockReturnValue(20);
        throw new Error("node detached");
      }
      return { root };
    });
    await expect(
      page.captureSnapshot({ ignoreLocators: [{ selector: ".card" }] }, progress),
    ).rejects.toThrow(/extract timed out/);
    await vi.advanceTimersByTimeAsync(0);
    expect(resolve).toHaveBeenCalledWith({ kind: "css", value: ".card" }, {}, progress);
    expect(send.mock.calls.filter(([method]) => method === "Runtime.releaseObject")).toEqual([
      ["Runtime.releaseObject", { objectId: "first" }],
      ["Runtime.releaseObject", { objectId: "second" }],
    ]);
    expect(send.mock.calls.filter(([method]) => method === "DOM.describeNode")).toHaveLength(1);
    expect(a11yForFrame).not.toHaveBeenCalled();
  });
});
