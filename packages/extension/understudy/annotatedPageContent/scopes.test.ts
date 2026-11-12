import { afterEach, describe, expect, it, vi } from "vitest";
import { scopeAnnotatedPageContent } from "./scopes.js";
import { prepareAnnotatedPageContentQuery } from "./query.js";
import { control } from "./fixtures/controls.js";
import type { Page } from "../page.js";
import type { Frame } from "../frame.js";
import { Progress } from "../progress.js";
import { executionContexts } from "../executionContextRegistry.js";
import { resolveContentFrame } from "../frameLocator.js";

vi.mock("../frameLocator.js", () => ({ resolveContentFrame: vi.fn() }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function fixture() {
  const main = { frameId: "main" } as Frame;
  const child = { frameId: "child" } as Frame;
  const nodes = ["main", "child", "duplicate", "unresolved"].map((name) =>
    control("FORM_CONTROL_TYPE_INPUT_TEXT", name),
  );
  const mainTarget = { id: "0-42", frame: main, backendNodeId: 42 };
  const childTarget = { id: "1-42", frame: child, backendNodeId: 42 };
  const query = prepareAnnotatedPageContentQuery(
    { rootNode: { childrenNodes: nodes } },
    ["fill"],
    undefined,
    new Map([
      [nodes[0]!, mainTarget],
      [nodes[1]!, childTarget],
      [nodes[2]!, mainTarget],
    ]),
  );
  return { main, child, query };
}

describe("APC scopes", () => {
  it("unions documents in capture order and deduplicates by frame and backend identity", async () => {
    const { main, child, query } = fixture();
    const page = {} as Page;
    const progress = new Progress("apc", 1000);
    try {
      const result = await scopeAnnotatedPageContent(
        page,
        query,
        [
          { type: "document", frame: child },
          { type: "document", frame: main },
          { type: "document", frame: main },
        ],
        progress,
      );
      expect(result.nodes.map((node) => node.id)).toEqual(["0-42", "1-42"]);
      expect([...result.targetsById.keys()]).toEqual(["0-42", "1-42"]);
      expect((await scopeAnnotatedPageContent(page, query, [], progress)).nodes).toEqual([]);
      expect(
        (
          await scopeAnnotatedPageContent(
            page,
            query,
            [{ type: "document", frame: child }],
            progress,
          )
        ).nodes.map((node) => node.id),
      ).toEqual(["1-42"]);
    } finally {
      progress.dispose();
    }
  });

  it("resolves iframe owners to the content document rather than the owner document", async () => {
    const { main, child, query } = fixture();
    const page = {} as Page;
    const progress = new Progress("apc", 1000);
    vi.mocked(resolveContentFrame).mockResolvedValue(child);
    try {
      const result = await scopeAnnotatedPageContent(
        page,
        query,
        [{ type: "frame", target: { frame: main, backendNodeId: 10 } }],
        progress,
      );
      expect(result.nodes.map((node) => node.id)).toEqual(["1-42"]);
      expect(resolveContentFrame).toHaveBeenCalledExactlyOnceWith(page, main, 10, progress);
    } finally {
      progress.dispose();
    }
  });

  it("releases scope and candidate handles when containment fails", async () => {
    const { main, query } = fixture();
    const send = vi.fn(async (method: string, params?: { backendNodeId?: number }) => {
      if (method === "DOM.resolveNode")
        return { object: { objectId: String(params?.backendNodeId) } };
      if (method === "Runtime.callFunctionOn") throw new Error("Context lost");
      return {};
    });
    main.session = { send } as unknown as Frame["session"];
    vi.spyOn(executionContexts, "waitForLocatorWorld").mockResolvedValue({
      contextId: 7,
      kind: "extension",
      capabilities: { closedShadowRoots: true },
    });
    const progress = new Progress("apc", 1000);
    try {
      await expect(
        scopeAnnotatedPageContent(
          {} as Page,
          query,
          [{ type: "element", target: { frame: main, backendNodeId: 9 } }],
          progress,
        ),
      ).rejects.toThrow("Context lost");
      expect(send).toHaveBeenCalledWith("Runtime.releaseObject", { objectId: "9" });
      expect(send).toHaveBeenCalledWith("Runtime.releaseObject", { objectId: "42" });
    } finally {
      progress.dispose();
    }
  });
  it("keeps the caller deadline and releases a handle returned after timeout", async () => {
    vi.useFakeTimers();
    const { main, query } = fixture();
    let respond!: (value: unknown) => void;
    const send = vi.fn(async (method: string) => {
      if (method === "DOM.resolveNode")
        return new Promise((resolve) => {
          respond = resolve;
        });
      return {};
    });
    main.session = { send } as unknown as Frame["session"];
    vi.spyOn(executionContexts, "waitForLocatorWorld").mockResolvedValue({
      contextId: 7,
      kind: "extension",
      capabilities: { closedShadowRoots: true },
    });
    const progress = new Progress("locate", 100);
    try {
      const failed = expect(
        scopeAnnotatedPageContent(
          {} as Page,
          query,
          [{ type: "element", target: { frame: main, backendNodeId: 9 } }],
          progress,
        ),
      ).rejects.toThrow("locate timed out after 100ms");
      await vi.advanceTimersByTimeAsync(100);
      await failed;
      respond({ object: { objectId: "late-root" } });
      await vi.advanceTimersByTimeAsync(0);
      expect(send).toHaveBeenCalledWith("Runtime.releaseObject", { objectId: "late-root" });
      expect(send).not.toHaveBeenCalledWith("Runtime.callFunctionOn", expect.anything());
    } finally {
      progress.dispose();
    }
  });
});
