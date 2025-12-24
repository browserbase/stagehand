import type { Protocol } from "devtools-protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CDPSessionLike } from "../lib/v3/understudy/cdp";
import type { Page } from "../lib/v3/understudy/page";
import type { FrameContext, SessionDomIndex } from "../lib/v3/types/private";
import * as capture from "../lib/v3/understudy/a11y/snapshot/capture";
import * as a11yTree from "../lib/v3/understudy/a11y/snapshot/a11yTree";
import * as domTree from "../lib/v3/understudy/a11y/snapshot/domTree";
import * as focusSelectors from "../lib/v3/understudy/a11y/snapshot/focusSelectors";
import { MockCDPSession } from "./helpers/mockCDPSession";

const makeProtocolFrame = (id: string): Protocol.Page.Frame =>
  ({
    id,
    loaderId: `${id}-loader`,
    url: "https://example.com",
    securityOrigin: "https://example.com",
    mimeType: "text/html",
  }) as unknown as Protocol.Page.Frame;

const makeFrameTree = (
  id: string,
  children: Protocol.Page.FrameTree[] = [],
): Protocol.Page.FrameTree => ({
  frame: makeProtocolFrame(id),
  childFrames: children,
});

type PageStub = Pick<
  Page,
  | "mainFrameId"
  | "asProtocolFrameTree"
  | "listAllFrameIds"
  | "getSessionForFrame"
  | "getOrdinal"
>;

const makePage = (overrides: Partial<PageStub> = {}): Page => {
  const defaultSession = new MockCDPSession({}, "default-session");
  const base: PageStub = {
    mainFrameId: () => "frame-1",
    asProtocolFrameTree: () => makeFrameTree("frame-1"),
    listAllFrameIds: () => ["frame-1"],
    getSessionForFrame: () => defaultSession,
    getOrdinal: () => 0,
  };
  return { ...base, ...overrides } as unknown as Page;
};

const makeSessionIndex = (): SessionDomIndex => ({
  rootBackend: 100,
  absByBe: new Map([
    [100, "/"],
    [101, "/html[1]"],
    [102, "/html[1]/body[1]"],
    [150, "/html[1]/body[1]/iframe[1]"],
    [200, "/html[1]/body[1]/iframe[1]"],
    [201, "/html[1]/body[1]/iframe[1]/div[1]"],
  ]),
  tagByBe: new Map([
    [100, "#document"],
    [101, "html"],
    [102, "body"],
    [150, "iframe"],
    [200, "#document"],
    [201, "div"],
  ]),
  scrollByBe: new Map([[201, true]]),
  docRootOf: new Map([
    [100, 100],
    [101, 100],
    [102, 100],
    [150, 100],
    [200, 200],
    [201, 200],
  ]),
  contentDocRootByIframe: new Map([[150, 200]]),
});

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("buildFrameContext", () => {
  it("indexes parent relationships from the frame tree", () => {
    const frameTree = makeFrameTree("frame-1", [
      makeFrameTree("frame-2", [makeFrameTree("frame-3")]),
      makeFrameTree("frame-4"),
    ]);
    const page = makePage({
      asProtocolFrameTree: () => frameTree,
      listAllFrameIds: () => ["frame-1", "frame-2", "frame-3", "frame-4"],
    });

    const context = capture.buildFrameContext(page);

    expect(context.rootId).toBe("frame-1");
    expect(context.frames).toEqual([
      "frame-1",
      "frame-2",
      "frame-3",
      "frame-4",
    ]);
    expect(context.parentByFrame.get("frame-1")).toBeNull();
    expect(context.parentByFrame.get("frame-2")).toBe("frame-1");
    expect(context.parentByFrame.get("frame-3")).toBe("frame-2");
    expect(context.parentByFrame.get("frame-4")).toBe("frame-1");
  });
});

describe("buildSessionIndexes", () => {
  it("deduplicates frames that share the same CDP session id", async () => {
    const session = new MockCDPSession({}, "session-a");
    const page = makePage({
      // Every frame lookup returns the same session instance, so buildSessionIndexes
      // should call buildSessionDomIndex only once and reuse the result.
      getSessionForFrame: () => session,
    });
    const idx = makeSessionIndex();
    const spy = vi
      .spyOn(domTree, "buildSessionDomIndex")
      .mockResolvedValue(idx);

    const result = await capture.buildSessionIndexes(
      page,
      ["frame-1", "frame-2"],
      true,
    );

    expect(spy).toHaveBeenCalledTimes(1); // only one DOM.getDocument per session id
    expect(spy).toHaveBeenCalledWith(session, true);
    expect(result.get("session-a")).toBe(idx);
  });

  it("builds indexes for sessions without ids using the 'root' key", async () => {
    const sessionWithoutId: CDPSessionLike = {
      id: undefined,
      async send<R = unknown>(
        _method: string,
        _params?: Record<string, unknown>,
      ): Promise<R> {
        void _method;
        void _params;
        return {} as R;
      },
      on() {},
      off() {},
      async close() {},
    };
    const sessionWithId = new MockCDPSession({}, "child-session");
    const page = makePage({
      getSessionForFrame: (frameId: string) =>
        frameId === "frame-1" ? sessionWithoutId : sessionWithId,
    });

    const idxA = makeSessionIndex();
    const idxB = makeSessionIndex();
    const spy = vi
      .spyOn(domTree, "buildSessionDomIndex")
      .mockResolvedValueOnce(idxA)
      .mockResolvedValueOnce(idxB);

    const result = await capture.buildSessionIndexes(
      page,
      ["frame-1", "frame-2"],
      false,
    );

    // Verifies the helper invokes buildSessionDomIndex once for each unique session,
    // keying anonymous sessions as "root" so downstream lookups remain stable.
    expect(spy).toHaveBeenNthCalledWith(1, sessionWithoutId, false);
    expect(spy).toHaveBeenNthCalledWith(2, sessionWithId, false);
    expect(result.get("root")).toBe(idxA);
    expect(result.get("child-session")).toBe(idxB);
  });
});

describe("collectPerFrameMaps", () => {
  it("builds per-frame xpath/tag maps and outlines from a shared session index", async () => {
    const session = new MockCDPSession(
      {
        "DOM.getFrameOwner": async () => ({ backendNodeId: 150 }),
      },
      "session-a",
    );
    const page = makePage({
      getSessionForFrame: () => session,
      getOrdinal: (frameId: string) => (frameId === "frame-1" ? 0 : 1),
    });
    const context: FrameContext = {
      rootId: "frame-1",
      frames: ["frame-1", "frame-2"],
      parentByFrame: new Map([
        ["frame-1", null],
        ["frame-2", "frame-1"],
      ]),
    };
    const sessionIndex = makeSessionIndex();
    const sessionToIndex = new Map([[session.id, sessionIndex]]);

    vi.spyOn(a11yTree, "a11yForFrame").mockImplementation(
      async (_sess, frameId) => ({
        outline: `outline-${frameId}`,
        urlMap: { [`url-${frameId}`]: `https://${frameId}.test` },
        scopeApplied: false,
      }),
    );

    const result = await capture.collectPerFrameMaps(
      page,
      context,
      sessionToIndex,
      { experimental: true },
      true,
    );

    expect(result.perFrameOutlines).toEqual([
      { frameId: "frame-1", outline: "outline-frame-1" },
      { frameId: "frame-2", outline: "outline-frame-2" },
    ]);
    const rootMaps = result.perFrameMaps.get("frame-1");
    expect(rootMaps?.xpathMap["0-100"]).toBe("/");
    expect(rootMaps?.xpathMap["0-101"]).toBe("/html[1]");
    expect(rootMaps?.xpathMap["0-102"]).toBe("/html[1]/body[1]");
    const childMaps = result.perFrameMaps.get("frame-2");
    expect(childMaps?.xpathMap["1-200"]).toBe("/");
    expect(childMaps?.xpathMap["1-201"]).toBe("/div[1]");
    expect(childMaps?.scrollableMap["1-201"]).toBe(true);
    expect(childMaps?.urlMap).toEqual({
      "url-frame-2": "https://frame-2.test",
    });
    expect(session.callsFor("DOM.getFrameOwner")).toHaveLength(1);
  });

  it("builds a missing session index on demand and memoizes it", async () => {
    const session = new MockCDPSession({}, "new-session");
    const page = makePage({
      getSessionForFrame: () => session,
      getOrdinal: () => 2,
    });
    const context: FrameContext = {
      rootId: "frame-9",
      frames: ["frame-9"],
      parentByFrame: new Map([["frame-9", null]]),
    };
    const idx = makeSessionIndex();
    const buildSpy = vi
      .spyOn(domTree, "buildSessionDomIndex")
      .mockResolvedValue(idx);
    vi.spyOn(a11yTree, "a11yForFrame").mockResolvedValue({
      outline: "outline",
      urlMap: {},
      scopeApplied: false,
    });

    const sessionToIndex = new Map<string, SessionDomIndex>();
    const result = await capture.collectPerFrameMaps(
      page,
      context,
      sessionToIndex,
      undefined,
      false,
    );

    expect(buildSpy).toHaveBeenCalledWith(session, false);
    expect(sessionToIndex.get("new-session")).toBe(idx);
    expect(result.perFrameMaps.get("frame-9")?.xpathMap["2-100"]).toBe("/");
  });
});

describe("captureHybridSnapshot", () => {
  it("returns early when the scoped snapshot path succeeds", async () => {
    const session = new MockCDPSession({}, "session-a");
    const page = makePage({
      getSessionForFrame: () => session,
    });
    const options = { focusSelector: "/html" };

    vi.spyOn(focusSelectors, "resolveFocusFrameAndTail").mockResolvedValue({
      targetFrameId: "frame-1",
      tailXPath: "",
      absPrefix: "",
    });
    const domMapsSpy = vi
      .spyOn(domTree, "domMapsForSession")
      .mockResolvedValue({
        tagNameMap: { "0-100": "#document" },
        xpathMap: { "0-100": "/" },
        scrollableMap: {},
      });
    const a11ySpy = vi.spyOn(a11yTree, "a11yForFrame").mockResolvedValue({
      outline: "scoped outline",
      urlMap: { "0-100": "https://frame-1.test" },
      scopeApplied: true,
    });
    const buildIndexSpy = vi
      .spyOn(domTree, "buildSessionDomIndex")
      .mockImplementation(() => {
        throw new Error("should not build session index when scoped");
      });

    const result = await capture.captureHybridSnapshot(page, options);

    expect(result.combinedTree).toBe("scoped outline");
    expect(result.combinedUrlMap["0-100"]).toBe("https://frame-1.test");
    expect(domMapsSpy).toHaveBeenCalled();
    expect(a11ySpy).toHaveBeenCalled();
    expect(buildIndexSpy).not.toHaveBeenCalled();
  });

  it("collects per-frame data and merges it when no scoped snapshot is available", async () => {
    const session = new MockCDPSession(
      {
        "DOM.getFrameOwner": async () => ({ backendNodeId: 150 }),
      },
      "session-a",
    );
    const page = makePage({
      asProtocolFrameTree: () =>
        makeFrameTree("frame-1", [makeFrameTree("frame-2")]),
      listAllFrameIds: () => ["frame-1", "frame-2"],
      getSessionForFrame: () => session,
      getOrdinal: (frameId: string) => (frameId === "frame-1" ? 0 : 1),
    });

    const idx = makeSessionIndex();
    vi.spyOn(domTree, "buildSessionDomIndex").mockResolvedValue(idx);
    vi.spyOn(a11yTree, "a11yForFrame").mockImplementation(
      async (_sess, frameId) => ({
        outline:
          frameId === "frame-1"
            ? "[0-150] iframe host"
            : "[1-200] child subtree",
        urlMap: { [`url-${frameId}`]: `https://${frameId}.test` },
        scopeApplied: false,
      }),
    );

    const snapshot = await capture.captureHybridSnapshot(page);

    expect(snapshot.combinedTree).toContain("[1-200] child subtree");
    expect(snapshot.combinedXpathMap["0-100"]).toBe("/");
    expect(snapshot.combinedXpathMap["1-201"]).toBe(
      "/html[1]/body[1]/iframe[1]/div[1]",
    );
    expect(snapshot.combinedUrlMap["url-frame-2"]).toBe("https://frame-2.test");
    expect(snapshot.perFrame?.map((pf) => pf.frameId)).toEqual([
      "frame-1",
      "frame-2",
    ]);
  });
});
