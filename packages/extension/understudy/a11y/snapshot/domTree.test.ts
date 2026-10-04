import type { Protocol } from "devtools-protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CDPSessionLike } from "../../cdp.js";
import { Progress } from "../../progress.js";
import { buildSessionDomIndex, getDomTreeWithFallback, hydrateDomTree } from "./domTree.js";

describe("DOM tree adaptive retries", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(["DOM.getDocument", "DOM.describeNode"])(
    "stops waiting for %s and ignores its late retryable error",
    async (command) => {
      vi.useFakeTimers();
      const progress = new Progress("snapshot", 10);
      let reject!: (error: Error) => void;
      const pending = new Promise<never>((_, fail) => {
        reject = fail;
      });
      const send = vi.fn(() => pending);
      const session = { send } as unknown as CDPSessionLike;
      const read =
        command === "DOM.getDocument"
          ? getDomTreeWithFallback(session, true, progress)
          : hydrateDomTree(
              session,
              { nodeId: 1, childNodeCount: 1 } as Protocol.DOM.Node,
              true,
              progress,
            );
      const timedOut = expect(read).rejects.toThrow(/snapshot timed out/);
      try {
        await vi.advanceTimersByTimeAsync(10);
        await timedOut;
        reject(new Error("CBOR: stack limit exceeded"));
        await vi.advanceTimersByTimeAsync(0);
        expect(send).toHaveBeenCalledOnce();
      } finally {
        reject(new Error("test cleanup"));
        progress.dispose();
      }
    },
  );

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

describe("session DOM index frame and shadow traversal", () => {
  it.each([false, true])("keeps iframe documents with pierceShadow=%s", async (pierce) => {
    const node = (
      id: number,
      name: string,
      children: Protocol.DOM.Node[] = [],
    ): Protocol.DOM.Node => ({
      nodeId: id,
      backendNodeId: id,
      nodeType: name === "#document" ? 9 : 1,
      nodeName: name,
      localName: name.toLowerCase(),
      nodeValue: "",
      childNodeCount: children.length,
      children,
    });
    const child = node(5, "#document", [node(6, "HTML", [node(7, "INPUT")])]);
    const frame = { ...node(4, "IFRAME"), contentDocument: child };
    const host = {
      ...node(8, "DIV"),
      shadowRoots: [node(9, "#document-fragment", [node(10, "BUTTON")])],
    };
    const root = node(1, "#document", [node(2, "HTML", [node(3, "BODY", [frame, host])])]);
    const send = vi.fn(async (method: string) => (method === "DOM.getDocument" ? { root } : {}));
    const index = await buildSessionDomIndex({ send } as unknown as CDPSessionLike, pierce);
    expect(send).toHaveBeenCalledWith("DOM.getDocument", { depth: -1, pierce: true });
    expect(index.contentDocRootByIframe.get(4)).toBe(5);
    expect(index.docRootOf.get(7)).toBe(5);
    expect(index.absByBe.has(10)).toBe(pierce);
  });
});
