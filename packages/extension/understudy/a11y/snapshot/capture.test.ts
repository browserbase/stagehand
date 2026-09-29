import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FrameContext, FrameDomMaps, SessionDomIndex } from "../../../types/private/index.js";
import type { StagehandLogger } from "../../../logger.js";
import type { Page } from "../../page.js";
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

      expect(resolveAtIndex).toHaveBeenCalledWith({ kind: "css", value: ".card" }, 1);
      expect(resolveAll).not.toHaveBeenCalled();
      expect(ignoredNodes.get("root")).toEqual(new Set([20]));
      expect(session.send).toHaveBeenCalledWith("DOM.describeNode", { objectId: "object-second" });
    } finally {
      resolveAtIndex.mockRestore();
      resolveAll.mockRestore();
    }
  });
});
