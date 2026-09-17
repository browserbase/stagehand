import type { Protocol } from "devtools-protocol";
import { describe, expect, it, vi } from "vitest";
import type { CDPSessionLike } from "../../cdp.js";
import { domMapsForSession, getDomTreeWithFallback, hydrateDomTree } from "./domTree.js";

describe("DOM tree adaptive retries", () => {
  it("throws the last original DOM.getDocument retry error", async () => {
    const errors = Array.from(
      { length: 10 },
      (_, index) => new Error(`CBOR: stack limit exceeded (${index})`),
    );
    const send = vi.fn(async () => {
      throw errors[send.mock.calls.length - 1]!;
    });
    const session = { send } as unknown as CDPSessionLike;

    await expect(getDomTreeWithFallback(session, true)).rejects.toBe(errors.at(-1));
    expect(send).toHaveBeenCalledTimes(10);
  });

  it("throws the last original DOM.describeNode retry error", async () => {
    const errors = Array.from(
      { length: 8 },
      (_, index) => new Error(`CBOR: stack limit exceeded (${index})`),
    );
    const send = vi.fn(async () => {
      throw errors[send.mock.calls.length - 1]!;
    });
    const session = { send } as unknown as CDPSessionLike;
    const root = {
      nodeId: 1,
      backendNodeId: 1,
      nodeType: 1,
      nodeName: "HTML",
      localName: "html",
      nodeValue: "",
      childNodeCount: 1,
      children: [],
    } as Protocol.DOM.Node;

    await expect(hydrateDomTree(session, root, true)).rejects.toBe(errors.at(-1));
    expect(send).toHaveBeenCalledTimes(8);
  });

  it("immediately rethrows a non-retryable CDP error", async () => {
    const original = new Error("Node not found");
    const send = vi.fn(async () => {
      throw original;
    });
    const session = { send } as unknown as CDPSessionLike;

    await expect(getDomTreeWithFallback(session, true)).rejects.toBe(original);
    expect(send).toHaveBeenCalledOnce();
  });
});

describe("locator hints", () => {
  it("collects safe unique hints only when requested", async () => {
    const root = domNode({
      nodeId: 1,
      backendNodeId: 1,
      nodeType: 9,
      nodeName: "#document",
      children: [
        domNode({
          nodeId: 2,
          backendNodeId: 2,
          nodeType: 1,
          nodeName: "HTML",
          children: [
            domNode({
              nodeId: 3,
              backendNodeId: 3,
              nodeType: 1,
              nodeName: "BUTTON",
              attributes: ["id", "submit-order", "data-testid", "submit"],
            }),
            domNode({
              nodeId: 4,
              backendNodeId: 4,
              nodeType: 1,
              nodeName: "INPUT",
              attributes: ["type", "password", "id", "password"],
            }),
          ],
        }),
      ],
    });
    const session = {
      send: vi.fn(async (method: string) => {
        if (method === "DOM.enable") return {};
        if (method === "DOM.getDocument") return { root };
        throw new Error(`Unexpected method: ${method}`);
      }),
    } as unknown as CDPSessionLike;

    const enabled = await domMapsForSession(
      session,
      "root",
      true,
      (_frame, id) => `0-${id}`,
      false,
      true,
    );
    const disabled = await domMapsForSession(
      session,
      "root",
      true,
      (_frame, id) => `0-${id}`,
      false,
      false,
    );

    expect(enabled.locatorHintsMap["0-3"]).toEqual([
      { text: "#submit-order" },
      { text: "testid=submit" },
    ]);
    expect(enabled.locatorHintsMap["0-4"]).toBeUndefined();
    expect(disabled.locatorHintsMap).toEqual({});
  });
});

function domNode(
  node: Partial<Protocol.DOM.Node> & Pick<Protocol.DOM.Node, "nodeId" | "nodeType" | "nodeName">,
): Protocol.DOM.Node {
  return {
    localName: node.nodeName.toLowerCase(),
    nodeValue: "",
    childNodeCount: node.children?.length ?? 0,
    ...node,
  } as Protocol.DOM.Node;
}
