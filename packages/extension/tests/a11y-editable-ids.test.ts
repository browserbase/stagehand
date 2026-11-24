import type { Protocol } from "devtools-protocol";
import { describe, expect, it } from "vitest";
import type { CDPSessionLike } from "../understudy/cdp.js";
import { a11yForFrame } from "../understudy/a11y/snapshot/a11yTree.js";

function axNode(
  nodeId: string,
  backendDOMNodeId: number,
  role: string,
  name: string,
  extra: Partial<Protocol.Accessibility.AXNode> = {},
): Protocol.Accessibility.AXNode {
  return {
    nodeId,
    backendDOMNodeId,
    ignored: false,
    role: { type: "role", value: role },
    name: { type: "computedString", value: name },
    ...extra,
  };
}

function editable(value: string): Protocol.Accessibility.AXProperty[] {
  return [{ name: "editable", value: { type: "token", value } }];
}

describe("a11yForFrame editable ids", () => {
  it("reports editable nodes by encoded id without changing the outline", async () => {
    const nodes = [
      axNode("1", 1, "RootWebArea", "Editor", { childIds: ["2", "3", "4", "5"] }),
      axNode("2", 2, "textbox", "Title", { parentId: "1", properties: editable("plaintext") }),
      // A contenteditable div: its role says nothing about being typeable.
      axNode("3", 3, "generic", "Body", { parentId: "1", properties: editable("richtext") }),
      axNode("4", 4, "button", "Save", { parentId: "1" }),
      axNode("5", 5, "textbox", "Hidden", { parentId: "1", properties: editable("plaintext") }),
    ];
    const session = {
      send: async (method: string) => (method === "Accessibility.getFullAXTree" ? { nodes } : {}),
    } as unknown as CDPSessionLike;

    const result = await a11yForFrame(session, undefined, {
      tagNameMap: {},
      scrollableMap: {},
      encode: (backendNodeId) => `0-${backendNodeId}`,
      isIgnoredBackendNode: (backendNodeId) => backendNodeId === 5,
    });

    expect(result.editableIds).toEqual(["0-2", "0-3"]);
    expect(result.outline).toContain("button: Save");
    expect(result.outline).not.toContain("editable");
  });
});
