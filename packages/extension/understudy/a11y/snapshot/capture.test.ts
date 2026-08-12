import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FrameContext, FrameDomMaps } from "../../../types/private/index.js";
import type { StagehandLogger } from "../../../logger.js";
import type { Page } from "../../page.js";
import { FrameSelectorResolver } from "../../selectorResolver.js";
import { a11yForFrame } from "./a11yTree.js";
import { mergeFramesIntoSnapshot, resolveIgnoredNodes, tryScopedSnapshot } from "./capture.js";
import { domMapsForSession } from "./domTree.js";
import { resolveCssFocusFrameAndTail } from "./focusSelectors.js";
import { ownerSession } from "./sessions.js";

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
}));

const emptyMaps = (): FrameDomMaps => ({
  tagNameMap: {},
  xpathMap: {},
  scrollableMap: {},
  urlMap: {},
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
