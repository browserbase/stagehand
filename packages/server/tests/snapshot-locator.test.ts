import type { Protocol } from "devtools-protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Page } from "../understudy/page.js";
import type { CDPSessionLike } from "../understudy/cdp.js";
import { executionContexts } from "../understudy/executionContextRegistry.js";
import { FrameSelectorResolver, type ResolvedNode } from "../understudy/selectorResolver.js";
import type { FrameContext } from "../types/private/index.js";
import { a11yForFrame } from "../understudy/a11y/snapshot/a11yTree.js";
import { captureHybridSnapshot, resolveIgnoredNodes } from "../understudy/a11y/snapshot/capture.js";
import {
  resolveObjectIdForCss,
  resolveObjectIdForXPath,
} from "../understudy/a11y/snapshot/focusSelectors.js";

describe("snapshot locator resolution", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ["CSS", resolveObjectIdForCss, "button", "resolveCssSelector"],
    ["XPath", resolveObjectIdForXPath, "//button", "resolveXPathMainWorld"],
  ] as const)(
    "passes a locator's nth index to the %s resolver",
    async (_, resolve, selector, helper) => {
      const send = vi.fn(async (_method: string, _params?: object) => ({
        result: { objectId: "object-3" },
      }));
      const session = {
        id: "session-1",
        send,
        on: vi.fn(),
        off: vi.fn(),
        close: vi.fn(),
      } as unknown as CDPSessionLike;
      executionContexts.registerExtensionWorld(session, "frame-1", 42);

      await expect(resolve(session, selector, "frame-1", 3)).resolves.toBe("object-3");

      expect(send).toHaveBeenCalledWith(
        "Runtime.evaluate",
        expect.objectContaining({
          expression: expect.stringContaining(`scripts[${JSON.stringify(helper)}]`),
          contextId: 42,
        }),
      );
      expect(send.mock.calls[0]?.[1]).toEqual(
        expect.objectContaining({
          expression: expect.stringMatching(/,\s*3\);\s*}\)\(\)$/),
        }),
      );
    },
  );

  it.each([
    ["CSS", { selector: ".card", nth: 1 }],
    ["XPath", { selector: "xpath=//section", nth: 1 }],
  ] as const)("limits the %s accessibility outline to focusLocator.nth", async (_, locator) => {
    const { session } = focusedSnapshotHarness();

    const result = await a11yForFrame(session, "frame-1", {
      focusLocator: locator,
      tagNameMap: {},
      scrollableMap: {},
      encode: (backendNodeId) => `0-${backendNodeId}`,
    });

    expect(result.scopeApplied).toBe(true);
    expect(result.outline).toContain("Second scope");
    expect(result.outline).toContain("Second action");
    expect(result.outline).not.toContain("First scope");
    expect(result.outline).not.toContain("First action");
  });

  it.each([
    ["CSS", { selector: ".card", nth: 1 }],
    ["XPath", { selector: "xpath=//section", nth: 1 }],
  ] as const)("returns a %s capture scoped to focusLocator.nth", async (_, locator) => {
    const { page } = focusedSnapshotHarness();

    const snapshot = await captureHybridSnapshot(page, { focusLocator: locator });

    expect(snapshot.combinedTree).toContain("Second scope");
    expect(snapshot.combinedTree).toContain("Second action");
    expect(snapshot.combinedTree).not.toContain("First scope");
    expect(snapshot.combinedTree).not.toContain("First action");
  });

  it("resolves every ignored match when nth is omitted", async () => {
    const { page, context, send } = ignoredLocatorHarness();
    vi.spyOn(FrameSelectorResolver.prototype, "resolveAll").mockResolvedValue([
      resolvedNode("object-1"),
      resolvedNode("object-2"),
    ]);

    const ignored = await resolveIgnoredNodes(
      page,
      [{ selector: ".advertisement" }],
      context,
      new Map(),
    );

    expect(ignored).toStrictEqual(new Map([["frame-1", new Set([101, 202])]]));
    expect(send).toHaveBeenCalledWith("DOM.describeNode", { objectId: "object-1" });
    expect(send).toHaveBeenCalledWith("DOM.describeNode", { objectId: "object-2" });
  });

  it("resolves only the indexed ignored match when nth is present", async () => {
    const { page, context, send } = ignoredLocatorHarness();
    const resolveAll = vi
      .spyOn(FrameSelectorResolver.prototype, "resolveAll")
      .mockResolvedValue([resolvedNode("object-1"), resolvedNode("object-2")]);

    const ignored = await resolveIgnoredNodes(
      page,
      [{ selector: ".advertisement", nth: 1 }],
      context,
      new Map(),
    );

    expect(resolveAll).toHaveBeenCalledWith({ kind: "css", value: ".advertisement" }, { limit: 2 });
    expect(ignored).toStrictEqual(new Map([["frame-1", new Set([202])]]));
    expect(send).not.toHaveBeenCalledWith("DOM.describeNode", { objectId: "object-1" });
    expect(send).toHaveBeenCalledWith("DOM.describeNode", { objectId: "object-2" });
  });

  it("ignores nothing when nth is out of range", async () => {
    const { page, context, send } = ignoredLocatorHarness();
    vi.spyOn(FrameSelectorResolver.prototype, "resolveAll").mockResolvedValue([
      resolvedNode("object-1"),
      resolvedNode("object-2"),
    ]);

    const ignored = await resolveIgnoredNodes(
      page,
      [{ selector: ".advertisement", nth: 2 }],
      context,
      new Map(),
    );

    expect(ignored).toStrictEqual(new Map());
    expect(send).not.toHaveBeenCalledWith("DOM.describeNode", expect.anything());
  });
});

function resolvedNode(objectId: string): ResolvedNode {
  return { objectId, nodeId: null };
}

function ignoredLocatorHarness(): {
  page: Page;
  context: FrameContext;
  send: ReturnType<typeof vi.fn>;
} {
  const backendNodeIds: Record<string, number> = {
    "object-1": 101,
    "object-2": 202,
  };
  const send = vi.fn(async (method: string, params?: { objectId?: string }) => {
    if (method === "DOM.describeNode") {
      return { node: { backendNodeId: backendNodeIds[params?.objectId ?? ""] } };
    }
    return {};
  });
  const session = {
    id: "session-ignore",
    send,
    on: vi.fn(),
    off: vi.fn(),
    close: vi.fn(),
  } as unknown as CDPSessionLike;
  const page = {
    getSessionForFrame: vi.fn(() => session),
    logger: {},
  } as unknown as Page;
  const context: FrameContext = {
    rootId: "frame-1",
    parentByFrame: new Map([["frame-1", null]]),
    frames: ["frame-1"],
  };
  return { page, context, send };
}

function focusedSnapshotHarness(): {
  page: Page;
  session: CDPSessionLike;
} {
  const accessibilityNodes = [
    {
      nodeId: "root",
      ignored: false,
      role: { type: "role", value: "RootWebArea" },
      childIds: ["first", "second"],
    },
    {
      nodeId: "first",
      ignored: false,
      role: { type: "role", value: "region" },
      name: { type: "computedString", value: "First scope" },
      backendDOMNodeId: 101,
      parentId: "root",
      childIds: ["first-action"],
    },
    {
      nodeId: "first-action",
      ignored: false,
      role: { type: "role", value: "button" },
      name: { type: "computedString", value: "First action" },
      backendDOMNodeId: 111,
      parentId: "first",
    },
    {
      nodeId: "second",
      ignored: false,
      role: { type: "role", value: "region" },
      name: { type: "computedString", value: "Second scope" },
      backendDOMNodeId: 202,
      parentId: "root",
      childIds: ["second-action"],
    },
    {
      nodeId: "second-action",
      ignored: false,
      role: { type: "role", value: "button" },
      name: { type: "computedString", value: "Second action" },
      backendDOMNodeId: 222,
      parentId: "second",
    },
  ] as Protocol.Accessibility.AXNode[];
  const domRoot = {
    nodeId: 1,
    backendNodeId: 1,
    nodeType: 9,
    nodeName: "#document",
    localName: "",
    nodeValue: "",
    childNodeCount: 2,
    children: [
      {
        nodeId: 2,
        backendNodeId: 101,
        nodeType: 1,
        nodeName: "SECTION",
        localName: "section",
        nodeValue: "",
        childNodeCount: 0,
        attributes: ["class", "card"],
      },
      {
        nodeId: 3,
        backendNodeId: 202,
        nodeType: 1,
        nodeName: "SECTION",
        localName: "section",
        nodeValue: "",
        childNodeCount: 0,
        attributes: ["class", "card"],
      },
    ],
  } as Protocol.DOM.Node;
  const send = vi.fn(async (method: string) => {
    switch (method) {
      case "Accessibility.getFullAXTree":
        return { nodes: accessibilityNodes };
      case "DOM.getDocument":
        return { root: domRoot };
      case "DOM.describeNode":
        return { node: { backendNodeId: 202 } };
      case "Runtime.evaluate":
        return { result: { objectId: "object-2" } };
      default:
        return {};
    }
  });
  const session = {
    id: `session-focus-${Math.random()}`,
    send,
    on: vi.fn(),
    off: vi.fn(),
    close: vi.fn(),
  } as unknown as CDPSessionLike;
  executionContexts.registerExtensionWorld(session, "frame-1", 42);
  const page = {
    mainFrameId: vi.fn(() => "frame-1"),
    asProtocolFrameTree: vi.fn(
      () =>
        ({
          frame: {
            id: "frame-1",
            loaderId: "loader-1",
            url: "https://example.test",
            securityOrigin: "https://example.test",
            mimeType: "text/html",
          },
        }) as Protocol.Page.FrameTree,
    ),
    listAllFrameIds: vi.fn(() => ["frame-1"]),
    getSessionForFrame: vi.fn(() => session),
    getOrdinal: vi.fn(() => 0),
    logger: { warn: vi.fn() },
  } as unknown as Page;
  return { page, session };
}
