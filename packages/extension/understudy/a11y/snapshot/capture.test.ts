import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FrameContext, FrameDomMaps } from "../../../types/private/index.js";
import type { StagehandLogger } from "../../../logger.js";
import type { Page } from "../../page.js";
import { a11yForFrame } from "./a11yTree.js";
import { mergeFramesIntoSnapshot, tryScopedSnapshot } from "./capture.js";
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
      { focusLocator: { selector: "#target" } },
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
  });
});
