import type { Protocol } from "devtools-protocol";
import { afterEach, expect, it, vi } from "vitest";
import type { CDPSessionLike } from "../../cdp.js";
import { Progress } from "../../progress.js";
import { a11yForFrame } from "./a11yTree.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const options = { tagNameMap: {}, scrollableMap: {}, encode: String };

it("keeps the resolved focus subtree and excludes siblings", async () => {
  const session = {
    send: vi.fn(async () => ({ nodes: repeatedSubtreeNodes() })),
  } as unknown as CDPSessionLike;
  const result = await a11yForFrame(session, "root", { ...options, focusBackendNodeId: 20 });
  expect(result.scopeApplied).toBe(true);
  expect(result.outline).toContain("Second match");
  expect(result.outline).toContain("Second detail");
  expect(result.outline).not.toContain("First match");
  expect(result.outline).not.toContain("First detail");
});

it("falls back when the resolved focus is absent from the accessibility tree", async () => {
  const session = {
    send: vi.fn(async () => ({ nodes: repeatedSubtreeNodes() })),
  } as unknown as CDPSessionLike;
  const result = await a11yForFrame(session, "root", { ...options, focusBackendNodeId: 99 });
  expect(result.scopeApplied).toBe(false);
  expect(result.outline).toContain("First match");
  expect(result.outline).toContain("Second match");
});

it("does not fall back after reading the accessibility tree exceeds the deadline", async () => {
  vi.useFakeTimers();
  const progress = new Progress("act()", 10);
  const send = vi.fn(async (method: string) => {
    if (method === "Accessibility.getFullAXTree") {
      vi.spyOn(performance, "now").mockReturnValue(10);
      throw new Error("Frame with the given id is not found");
    }
    return {};
  });
  try {
    await expect(
      a11yForFrame({ send } as unknown as CDPSessionLike, "root", options, progress),
    ).rejects.toThrow(/act\(\) timed out/);
    expect(
      send.mock.calls.filter(([method]) => method === "Accessibility.getFullAXTree"),
    ).toHaveLength(1);
  } finally {
    progress.dispose();
  }
});

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
