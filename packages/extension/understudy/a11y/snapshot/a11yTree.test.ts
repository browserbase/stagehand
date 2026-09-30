import type { Protocol } from "devtools-protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CDPSessionLike } from "../../cdp.js";
import { Progress } from "../../progress.js";
import { a11yForFrame } from "./a11yTree.js";
import { resolveObjectIdForCss, resolveObjectIdForXPath } from "./focusSelectors.js";

vi.mock("./focusSelectors.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./focusSelectors.js")>()),
  resolveObjectIdForCss: vi.fn(),
  resolveObjectIdForXPath: vi.fn(),
}));

describe("a11yForFrame focused locators", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each(["Accessibility.getFullAXTree", "DOM.describeNode"])(
    "does not fall back after %s exceeds the deadline",
    async (command) => {
      vi.useFakeTimers();
      const progress = new Progress("act()", 10);
      vi.mocked(resolveObjectIdForCss).mockResolvedValue("object-second");
      const session = fakeSession(20, (method) => {
        if (method === command) {
          vi.spyOn(performance, "now").mockReturnValue(10);
          throw new Error("Frame with the given id is not found");
        }
      });
      const send = vi.spyOn(session, "send");
      try {
        await expect(
          a11yForFrame(
            session,
            "frame",
            {
              focusLocator: { selector: ".card" },
              tagNameMap: {},
              scrollableMap: {},
              encode: String,
            },
            progress,
          ),
        ).rejects.toThrow(/act\(\) timed out/);
        expect(send.mock.calls.filter(([method]) => method === command)).toHaveLength(1);
        if (command === "DOM.describeNode") {
          expect(resolveObjectIdForCss).toHaveBeenCalledWith(
            session,
            ".card",
            "frame",
            0,
            progress,
          );
          expect(send).toHaveBeenCalledWith("Runtime.releaseObject", {
            objectId: "object-second",
          });
        }
      } finally {
        progress.dispose();
      }
    },
  );

  it.each([
    {
      name: "CSS",
      selector: ".card",
      resolver: resolveObjectIdForCss,
    },
    {
      name: "XPath",
      selector: "xpath=//article",
      resolver: resolveObjectIdForXPath,
    },
  ])(
    "keeps the indexed $name focus subtree and excludes earlier matches",
    async ({ selector, resolver }) => {
      vi.mocked(resolver).mockResolvedValue("object-second");
      const session = fakeSession(20);
      const send = vi.spyOn(session, "send");

      const result = await a11yForFrame(session, "root-frame", {
        focusLocator: { selector, nth: 1 },
        tagNameMap: {},
        scrollableMap: {},
        encode: (backendNodeId) => `0-${backendNodeId}`,
      });

      expect(result.scopeApplied).toBe(true);
      expect(result.outline).toContain("Second match");
      expect(result.outline).toContain("Second detail");
      expect(result.outline).not.toContain("First match");
      expect(result.outline).not.toContain("First detail");
      expect(resolver).toHaveBeenCalledWith(session, selector, "root-frame", 1, undefined);
      expect(send).toHaveBeenCalledWith("Runtime.releaseObject", {
        objectId: "object-second",
      });
    },
  );
});

function fakeSession(
  focusedBackendNodeId: number,
  beforeSend?: (method: string) => void,
): CDPSessionLike {
  return {
    send: vi.fn(async (method: string, params?: Record<string, unknown>) => {
      beforeSend?.(method);
      if (
        method === "Accessibility.enable" ||
        method === "Runtime.enable" ||
        method === "DOM.enable" ||
        method === "Runtime.releaseObject"
      ) {
        return {};
      }
      if (method === "Accessibility.getFullAXTree") {
        return { nodes: repeatedSubtreeNodes() };
      }
      if (method === "DOM.describeNode" && params?.objectId === "object-second") {
        return { node: { backendNodeId: focusedBackendNodeId } };
      }
      throw new Error(`Unexpected method: ${method}`);
    }),
  } as unknown as CDPSessionLike;
}

function repeatedSubtreeNodes(): Protocol.Accessibility.AXNode[] {
  return [
    axNode({
      nodeId: "root",
      backendDOMNodeId: 1,
      role: "RootWebArea",
      name: "Example",
      childIds: ["first", "second"],
    }),
    axNode({
      nodeId: "first",
      backendDOMNodeId: 10,
      role: "group",
      name: "First match",
      parentId: "root",
      childIds: ["first-detail"],
    }),
    axNode({
      nodeId: "first-detail",
      backendDOMNodeId: 11,
      role: "StaticText",
      name: "First detail",
      parentId: "first",
    }),
    axNode({
      nodeId: "second",
      backendDOMNodeId: 20,
      role: "group",
      name: "Second match",
      parentId: "root",
      childIds: ["second-detail"],
    }),
    axNode({
      nodeId: "second-detail",
      backendDOMNodeId: 21,
      role: "StaticText",
      name: "Second detail",
      parentId: "second",
    }),
  ];
}

function axNode({
  nodeId,
  backendDOMNodeId,
  role,
  name,
  parentId,
  childIds,
}: {
  nodeId: string;
  backendDOMNodeId: number;
  role: string;
  name: string;
  parentId?: string;
  childIds?: string[];
}): Protocol.Accessibility.AXNode {
  return {
    nodeId,
    backendDOMNodeId,
    role: { type: "role", value: role },
    name: { type: "computedString", value: name },
    ...(parentId ? { parentId } : {}),
    ...(childIds ? { childIds } : {}),
  } as Protocol.Accessibility.AXNode;
}
