import type { Protocol } from "devtools-protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CDPSessionLike } from "../../cdp.js";
import { Progress } from "../../progress.js";
import { executionContexts } from "../../executionContextRegistry.js";
import { a11yForFrame, foldIntoHosts } from "./a11yTree.js";
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
          expect(send).toHaveBeenCalledWith("Runtime.releaseObject", {
            objectId: "object-second",
          });
        }
      } finally {
        progress.dispose();
      }
    },
  );

  it.each([".card", "xpath=//article"])(
    "bounds a stalled %s focus lookup by the caller's deadline",
    async (selector) => {
      vi.useFakeTimers();
      const progress = new Progress("snapshot", 10);
      const actual =
        await vi.importActual<typeof import("./focusSelectors.js")>("./focusSelectors.js");
      vi.mocked(resolveObjectIdForCss).mockImplementation(actual.resolveObjectIdForCss);
      vi.mocked(resolveObjectIdForXPath).mockImplementation(actual.resolveObjectIdForXPath);
      const session = fakeSession(20, async (method) => {
        if (method === "Runtime.evaluate") await new Promise((resolve) => setTimeout(resolve, 25));
      });
      executionContexts.registerExtensionWorld(session, "frame", 1);
      const send = vi.spyOn(session, "send");
      let failure: unknown;
      const settled = a11yForFrame(
        session,
        "frame",
        {
          focusLocator: { selector },
          tagNameMap: {},
          scrollableMap: {},
          encode: String,
        },
        progress,
      ).catch((error: unknown) => {
        failure = error;
      });
      try {
        await vi.advanceTimersByTimeAsync(10);
        const failureAtDeadline = failure;
        await vi.advanceTimersByTimeAsync(15);
        await settled;
        expect(failureAtDeadline).toBe(progress.signal.reason);
        expect(send).toHaveBeenCalledWith("Runtime.releaseObject", { objectId: "object-second" });
        expect(send).not.toHaveBeenCalledWith("DOM.describeNode", expect.anything());
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

describe("a11yForFrame values", () => {
  it("prints form control and numeric values, and drops text that repeats the value", async () => {
    const outline = await outlineFor(
      [
        axNode({
          nodeId: "root",
          backendDOMNodeId: 1,
          role: "RootWebArea",
          name: "Form",
          childIds: ["email", "editor", "volume"],
        }),
        axNode({
          nodeId: "email",
          backendDOMNodeId: 10,
          role: "textbox",
          name: "Email",
          value: "a@b.co",
          parentId: "root",
          childIds: ["email-inner"],
        }),
        axNode({
          nodeId: "email-inner",
          backendDOMNodeId: 11,
          role: "generic",
          name: "",
          parentId: "email",
          childIds: ["email-text"],
        }),
        axNode({
          nodeId: "email-text",
          backendDOMNodeId: 12,
          role: "StaticText",
          name: "a@b.co",
          parentId: "email-inner",
        }),
        axNode({
          nodeId: "editor",
          backendDOMNodeId: 20,
          role: "textbox",
          name: "Body",
          value: "Dear team",
          parentId: "root",
          childIds: ["editor-text"],
        }),
        axNode({
          nodeId: "editor-text",
          backendDOMNodeId: 21,
          role: "StaticText",
          name: "Dear team",
          parentId: "editor",
        }),
        axNode({
          nodeId: "volume",
          backendDOMNodeId: 30,
          role: "slider",
          name: "Volume",
          value: 3,
          parentId: "root",
        }),
      ],
      // The editor is a contenteditable div: its value repeats its text children.
      { "0-10": "input, email", "0-11": "div", "0-20": "div", "0-30": "div" },
    );

    expect(outline).toBe(
      [
        "[0-1] RootWebArea: Form",
        '  [0-10] textbox: Email = "a@b.co"',
        "  [0-20] textbox: Body",
        "    [0-21] StaticText: Dear team",
        "  [0-30] slider: Volume = 3",
      ].join("\n"),
    );
  });
});

describe("a11yForFrame folded nodes", () => {
  it("folds a host's internals into its line and keeps content slotted through them", async () => {
    const outline = await outlineFor(
      [
        axNode({
          nodeId: "root",
          backendDOMNodeId: 1,
          role: "RootWebArea",
          name: "Form",
          childIds: ["date", "box"],
        }),
        axNode({
          nodeId: "date",
          backendDOMNodeId: 10,
          role: "Date",
          name: "Birthday",
          value: "2025-07-23",
          parentId: "root",
          childIds: ["fields"],
        }),
        axNode({
          nodeId: "fields",
          backendDOMNodeId: 11,
          role: "generic",
          name: "",
          parentId: "date",
          childIds: ["month", "picker"],
        }),
        axNode({
          nodeId: "month",
          backendDOMNodeId: 12,
          role: "spinbutton",
          name: "Month Month",
          parentId: "fields",
        }),
        axNode({
          nodeId: "picker",
          backendDOMNodeId: 13,
          role: "button",
          name: "Show date picker",
          parentId: "fields",
        }),
        axNode({
          nodeId: "box",
          backendDOMNodeId: 20,
          role: "group",
          name: "Shipping",
          parentId: "root",
          childIds: ["slot"],
        }),
        axNode({
          nodeId: "slot",
          backendDOMNodeId: 21,
          role: "generic",
          name: "",
          parentId: "box",
          childIds: ["slotted"],
        }),
        axNode({
          nodeId: "slotted",
          backendDOMNodeId: 22,
          role: "StaticText",
          name: "Ships in 2 days",
          parentId: "slot",
        }),
      ],
      { "0-10": "input, date", "0-20": "fieldset" },
      [11, 12, 13, 21],
    );

    expect(outline).toBe(
      [
        "[0-1] RootWebArea: Form",
        '  [0-10] Date: Birthday = "2025-07-23" [format: YYYY-MM-DD]',
        "  [0-20] group: Shipping",
        "    [0-22] StaticText: Ships in 2 days",
      ].join("\n"),
    );
  });

  it("moves folded nodes' children up to the nearest kept ancestor", () => {
    const nodes = [
      axNode({ nodeId: "a", backendDOMNodeId: 1, role: "group", name: "A", childIds: ["b"] }),
      axNode({
        nodeId: "b",
        backendDOMNodeId: 2,
        role: "generic",
        name: "",
        parentId: "a",
        childIds: ["c", "d"],
      }),
      axNode({
        nodeId: "c",
        backendDOMNodeId: 3,
        role: "generic",
        name: "",
        parentId: "b",
        childIds: ["e"],
      }),
      axNode({ nodeId: "d", backendDOMNodeId: 4, role: "StaticText", name: "D", parentId: "b" }),
      axNode({ nodeId: "e", backendDOMNodeId: 5, role: "StaticText", name: "E", parentId: "c" }),
    ];

    const folded = foldIntoHosts(nodes, (be) => be === 2 || be === 3);

    expect(folded.map((n) => [n.nodeId, n.parentId, n.childIds])).toEqual([
      ["a", undefined, ["e", "d"]],
      ["d", "a", undefined],
      ["e", "a", undefined],
    ]);
    expect(foldIntoHosts(nodes, undefined)).toBe(nodes);
  });
});

async function outlineFor(
  nodes: Protocol.Accessibility.AXNode[],
  tagNameMap: Record<string, string>,
  foldedBackendNodeIds: number[] = [],
): Promise<string> {
  const session = {
    send: vi.fn(async (method: string) =>
      method === "Accessibility.getFullAXTree" ? { nodes } : {},
    ),
  } as unknown as CDPSessionLike;
  const { outline } = await a11yForFrame(session, "frame", {
    isFoldedBackendNode: (backendNodeId) => foldedBackendNodeIds.includes(backendNodeId),
    tagNameMap,
    scrollableMap: {},
    encode: (backendNodeId) => `0-${backendNodeId}`,
  });
  return outline;
}

function fakeSession(
  focusedBackendNodeId: number,
  beforeSend?: (method: string) => void | Promise<void>,
): CDPSessionLike {
  return {
    send: vi.fn(async (method: string, params?: Record<string, unknown>) => {
      await beforeSend?.(method);
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
      if (method === "Runtime.evaluate") {
        return { result: { type: "object", objectId: "object-second" } };
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
  value,
  parentId,
  childIds,
}: {
  nodeId: string;
  backendDOMNodeId: number;
  role: string;
  name: string;
  value?: string | number;
  parentId?: string;
  childIds?: string[];
}): Protocol.Accessibility.AXNode {
  return {
    nodeId,
    backendDOMNodeId,
    role: { type: "role", value: role },
    name: { type: "computedString", value: name },
    ...(value !== undefined
      ? { value: { type: typeof value === "number" ? "number" : "string", value } }
      : {}),
    ...(parentId ? { parentId } : {}),
    ...(childIds ? { childIds } : {}),
  } as Protocol.Accessibility.AXNode;
}
