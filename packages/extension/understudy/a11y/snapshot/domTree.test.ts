import type { Protocol } from "devtools-protocol";
import { describe, expect, it, vi } from "vite-plus/test";
import type { CDPSessionLike } from "../../cdp.js";
import { getDomTreeWithFallback, hydrateDomTree } from "./domTree.js";

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
