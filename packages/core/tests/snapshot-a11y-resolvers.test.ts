import type { Protocol } from "devtools-protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { a11yForFrame } from "../lib/v3/understudy/a11y/snapshot/a11yTree";
import type { AccessibilityTreeResult } from "../lib/v3/types/private";
import * as focusSelectors from "../lib/v3/understudy/a11y/snapshot/focusSelectors";
import { MockCDPSession } from "./helpers/mockCDPSession";
import { executionContexts } from "../lib/v3/understudy/executionContextRegistry";
import { tryScopedSnapshot } from "../lib/v3/understudy/a11y/snapshot/capture";
import type { FrameContext, A11yOptions } from "../lib/v3/types/private";
import type { Page } from "../lib/v3/understudy/page";
import * as domTree from "../lib/v3/understudy/a11y/snapshot/domTree";
import * as a11yTree from "../lib/v3/understudy/a11y/snapshot/a11yTree";
import * as logger from "../lib/v3/logger";

const stringType = "string" as Protocol.Accessibility.AXValueType;

const baseAxNodes = (): Protocol.Accessibility.AXNode[] => [
  {
    nodeId: "1",
    role: { type: stringType, value: "RootWebArea" },
    backendDOMNodeId: 100,
    childIds: ["2"],
    ignored: false,
  },
  {
    nodeId: "2",
    role: { type: stringType, value: "link" },
    name: { type: stringType, value: "Docs" },
    backendDOMNodeId: 101,
    parentId: "1",
    childIds: [],
    properties: [
      {
        name: "url",
        value: { type: stringType, value: "https://example.com" },
      },
    ],
    ignored: false,
  },
];

const baseHandlers = {
  "Accessibility.enable": async () => ({}),
  "Runtime.enable": async () => ({}),
  "DOM.enable": async () => ({}),
};

describe("a11yForFrame", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns full outline and url map when no focus selector is provided", async () => {
    const session = new MockCDPSession({
      ...baseHandlers,
      "Accessibility.getFullAXTree": async () => ({ nodes: baseAxNodes() }),
    });

    const opts: A11yOptions = {
      focusSelector: undefined,
      experimental: false,
      tagNameMap: { "enc-100": "#document", "enc-101": "a" },
      scrollableMap: {},
      encode: (backend) => `enc-${backend}`,
    };

    const result = await a11yForFrame(session, undefined, opts);

    expect(result.scopeApplied).toBe(false);
    expect(result.urlMap["enc-101"]).toBe("https://example.com");
    expect(result.outline).toContain("Docs");
  });

  it("scopes the tree to the resolved focus selector target", async () => {
    const nodes = baseAxNodes().map((n) =>
      n.nodeId === "2"
        ? {
            ...n,
            childIds: ["3"],
          }
        : n,
    );
    nodes.push({
      nodeId: "3",
      parentId: "2",
      childIds: [],
      role: { type: stringType, value: "StaticText" },
      backendDOMNodeId: 102,
      ignored: false,
    });

    let scopedOnce = false;
    const session = new MockCDPSession({
      ...baseHandlers,
      "Accessibility.getFullAXTree": async (params) => {
        if (params?.frameId && !scopedOnce) {
          scopedOnce = true;
          throw new Error("does not belong to the target");
        }
        return { nodes };
      },
      "DOM.describeNode": async () => ({
        node: { backendNodeId: 101 },
      }),
    });

    const resolveSpy = vi
      .spyOn(focusSelectors, "resolveObjectIdForXPath")
      .mockResolvedValue("object-1");

    const opts: A11yOptions = {
      focusSelector: "xpath=//a",
      experimental: false,
      tagNameMap: { "enc-101": "a" },
      scrollableMap: {},
      encode: (backend) => `enc-${backend}`,
    };

    const result = await a11yForFrame(session, "frame-1", opts);

    expect(result.scopeApplied).toBe(true);
    expect(result.outline).not.toContain("RootWebArea");
    expect(resolveSpy).toHaveBeenCalled();
    resolveSpy.mockRestore();
  });

  it("falls back to full tree when resolveObjectId throws", async () => {
    const session = new MockCDPSession({
      ...baseHandlers,
      "Accessibility.getFullAXTree": async () => ({ nodes: baseAxNodes() }),
    });
    vi.spyOn(focusSelectors, "resolveObjectIdForCss").mockRejectedValue(
      new Error("fail"),
    );
    const opts: A11yOptions = {
      focusSelector: ".btn",
      experimental: false,
      tagNameMap: {},
      scrollableMap: {},
      encode: (backend) => `enc-${backend}`,
    };

    const result = await a11yForFrame(session, "frame-1", opts);
    expect(result.scopeApplied).toBe(false);
  });
});

describe("resolveObjectIdForXPath", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("evaluates in the target frame's main world when available", async () => {
    vi.spyOn(executionContexts, "waitForMainWorld").mockResolvedValue(42);
    vi.spyOn(executionContexts, "getMainWorld").mockReturnValue(undefined);
    const session = new MockCDPSession({
      "Runtime.evaluate": async (params) => {
        expect(params?.contextId).toBe(42);
        return { result: { objectId: "node-obj" } };
      },
    });

    const objectId = await focusSelectors.resolveObjectIdForXPath(
      session,
      "//div",
      "frame-1",
    );
    expect(objectId).toBe("node-obj");
  });

  it("returns null when evaluation throws or reports exception details", async () => {
    vi.spyOn(executionContexts, "waitForMainWorld").mockRejectedValue(
      new Error("missing"),
    );
    vi.spyOn(executionContexts, "getMainWorld").mockReturnValue(undefined);
    const session = new MockCDPSession({
      "Runtime.evaluate": async () => ({
        result: {},
        exceptionDetails: { exception: { description: "bad" } },
      }),
    });

    const objectId = await focusSelectors.resolveObjectIdForXPath(
      session,
      "//div",
      "frame-2",
    );
    expect(objectId).toBeNull();
  });
});

describe("resolveObjectIdForCss", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns primary evaluation result when available", async () => {
    vi.spyOn(executionContexts, "waitForMainWorld").mockResolvedValue(7);
    const session = new MockCDPSession({
      "Runtime.evaluate": async () => ({
        result: { objectId: "primary-obj" },
      }),
    });
    const objectId = await focusSelectors.resolveObjectIdForCss(
      session,
      ".btn",
      "frame-1",
    );
    expect(objectId).toBe("primary-obj");
  });

  it("falls back to the pierce selector when the primary lookup fails", async () => {
    let call = 0;
    const session = new MockCDPSession({
      "Runtime.evaluate": async (params) => {
        call++;
        if (call === 1) {
          expect(String(params?.expression)).toContain("resolveCssSelector");
          return { result: {} };
        }
        expect(String(params?.expression)).toContain(
          "resolveCssSelectorPierce",
        );
        return { result: { objectId: "css-obj" } };
      },
    });

    const objectId = await focusSelectors.resolveObjectIdForCss(
      session,
      ".btn",
      undefined,
    );
    expect(objectId).toBe("css-obj");
  });

  it("returns null when both primary and fallback evaluations throw", async () => {
    vi.spyOn(executionContexts, "waitForMainWorld").mockResolvedValue(11);
    vi.spyOn(executionContexts, "getMainWorld").mockReturnValue(undefined);
    const session = new MockCDPSession({
      "Runtime.evaluate": async () => ({
        result: {},
        exceptionDetails: { exception: { description: "fail" } },
      }),
    });

    const objectId = await focusSelectors.resolveObjectIdForCss(
      session,
      ".missing",
      "frame-1",
    );
    expect(objectId).toBeNull();
  });
});

describe("tryScopedSnapshot", () => {
  const ordinal = (frameId: string) => (frameId === "frame-1" ? 0 : 1);
  const context: FrameContext = {
    rootId: "frame-1",
    frames: ["frame-1", "frame-2"],
    parentByFrame: new Map([
      ["frame-1", null],
      ["frame-2", "frame-1"],
    ]),
  };

  const makePage = (session: MockCDPSession, overrides?: Partial<Page>): Page =>
    ({
      mainFrameId: () => "frame-1",
      asProtocolFrameTree: () => ({
        frame: { id: "frame-1" as Protocol.Page.FrameId },
        childFrames: [{ frame: { id: "frame-2" as Protocol.Page.FrameId } }],
      }),
      listAllFrameIds: () => ["frame-1", "frame-2"],
      getSessionForFrame: () => session,
      getOrdinal: (fid: string) => ordinal(fid),
      ...overrides,
    }) as unknown as Page;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns scoped snapshot when focus selector resolves via CSS hops", async () => {
    const session = new MockCDPSession({});
    const domMapsSpy = vi
      .spyOn(domTree, "domMapsForSession")
      .mockResolvedValue({
        tagNameMap: { "1-10": "div" },
        xpathMap: { "1-10": "/div[1]" },
        scrollableMap: {},
      });
    const a11ySpy = vi.spyOn(a11yTree, "a11yForFrame").mockResolvedValue({
      outline: "[1-10] div",
      urlMap: { "1-10": "https://example.com" },
      scopeApplied: true,
    } as AccessibilityTreeResult);
    vi.spyOn(focusSelectors, "resolveCssFocusFrameAndTail").mockResolvedValue({
      targetFrameId: "frame-2",
      tailSelector: ".btn-inner",
      absPrefix: "/html/body/iframe[1]",
    });

    const result = await tryScopedSnapshot(
      makePage(session),
      { focusSelector: ".btn" },
      context,
      true,
    );

    expect(result).not.toBeNull();
    expect(result?.combinedXpathMap["1-10"]).toBe(
      "/html/body/iframe[1]/div[1]",
    );
    expect(domMapsSpy).toHaveBeenCalled();
    expect(a11ySpy).toHaveBeenCalled();
  });

  it("returns null and logs fallback when scope is not applied", async () => {
    const session = new MockCDPSession({});
    vi.spyOn(domTree, "domMapsForSession").mockResolvedValue({
      tagNameMap: { "1-10": "div" },
      xpathMap: { "1-10": "/div[1]" },
      scrollableMap: {},
    });
    vi.spyOn(a11yTree, "a11yForFrame").mockResolvedValue({
      outline: "ignored",
      urlMap: {},
      scopeApplied: false,
    } as AccessibilityTreeResult);
    const loggerSpy = vi.spyOn(logger, "v3Logger").mockImplementation(() => {});

    const result = await tryScopedSnapshot(
      makePage(session),
      { focusSelector: ".btn" },
      context,
      false,
    );

    expect(result).toBeNull();
    expect(loggerSpy).toHaveBeenCalled();
  });

  it("returns null immediately when no focus selector is provided", async () => {
    const result = await tryScopedSnapshot(
      makePage(new MockCDPSession({})),
      {},
      context,
      true,
    );
    expect(result).toBeNull();
  });

  it("supports XPath focus resolution branch", async () => {
    const session = new MockCDPSession({});
    vi.spyOn(domTree, "domMapsForSession").mockResolvedValue({
      tagNameMap: { "1-10": "div" },
      xpathMap: { "1-10": "/div[1]" },
      scrollableMap: {},
    });
    vi.spyOn(a11yTree, "a11yForFrame").mockResolvedValue({
      outline: "[1-10] div",
      urlMap: {},
      scopeApplied: true,
    } as AccessibilityTreeResult);
    vi.spyOn(focusSelectors, "resolveFocusFrameAndTail").mockResolvedValue({
      targetFrameId: "frame-1",
      tailXPath: "//div[1]",
      absPrefix: "",
    });

    const result = await tryScopedSnapshot(
      makePage(session),
      { focusSelector: "xpath=//div" },
      context,
      true,
    );

    expect(result).not.toBeNull();
    expect(result?.combinedXpathMap["1-10"]).toBe("/div[1]");
  });

  it("logs and returns null when resolver throws", async () => {
    const session = new MockCDPSession({});
    vi.spyOn(focusSelectors, "resolveCssFocusFrameAndTail").mockRejectedValue(
      new Error("bad selector"),
    );
    const loggerSpy = vi.spyOn(logger, "v3Logger").mockImplementation(() => {});

    const result = await tryScopedSnapshot(
      makePage(session),
      { focusSelector: ".bad" },
      context,
      true,
    );

    expect(result).toBeNull();
    expect(loggerSpy).toHaveBeenCalled();
  });
});
