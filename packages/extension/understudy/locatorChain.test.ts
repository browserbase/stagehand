import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocatorChain } from "@browserbasehq/stagehand-protocol/types";
import type { Frame } from "./frame.js";
import type { Page } from "./page.js";
import { resolveLocatorChain } from "./locatorChain.js";
import { FrameSelectorResolver } from "./selectorResolver.js";
import { Progress } from "./progress.js";

afterEach(() => vi.restoreAllMocks());

const chain: LocatorChain = {
  steps: [
    { type: "query", selector: { type: "css", value: ".card" }, nth: 1 },
    { type: "query", selector: { type: "css", value: "button" } },
  ],
};

describe("chain handle ownership", () => {
  it("keeps prompt descriptions out of deterministic DOM queries", async () => {
    const selector = { type: "prompt" as const, value: "the resume file input" };
    expect(() => FrameSelectorResolver.parseSelector(selector)).toThrow(
      "Prompt selectors require decision-based resolution",
    );
    const send = vi.fn(async (method: string) => {
      if (method === "DOM.describeNode")
        return { node: { backendNodeId: 1, localName: "section" } };
      return {};
    });
    const frame = { frameId: "root", session: { send } } as unknown as Frame;
    vi.spyOn(FrameSelectorResolver.prototype, "resolveAll").mockResolvedValue([
      { objectId: "scope", nodeId: null },
    ]);
    await expect(
      resolveLocatorChain({} as Page, frame, {
        steps: [
          { type: "query", selector: { type: "css", value: "#application" } },
          { type: "query", selector },
        ],
      }),
    ).rejects.toThrow("Prompt selectors require decision-based resolution");
    expect(send.mock.calls.map(([method]) => method)).toEqual([
      "DOM.describeNode",
      "Runtime.releaseObject",
    ]);
  });

  it("releases intermediate and terminal handles after selection", async () => {
    const send = vi.fn(async (method: string, params: Record<string, unknown>) => {
      if (method === "DOM.describeNode")
        return {
          node: {
            backendNodeId: params.objectId === "card-1" ? 1 : params.objectId === "card-2" ? 2 : 3,
            localName: params.objectId === "button" ? "button" : "section",
          },
        };
      if (method === "Runtime.callFunctionOn") {
        const args = params.arguments as Array<{ value: unknown }>;
        expect(params.objectId).toBe("card-2");
        return { result: args[1]!.value === 0 ? { objectId: "button" } : { subtype: "null" } };
      }
      return {};
    });
    const frame = { frameId: "root", session: { send } } as unknown as Frame;
    vi.spyOn(FrameSelectorResolver.prototype, "resolveAll").mockResolvedValue([
      { objectId: "card-1", nodeId: null },
      { objectId: "card-2", nodeId: null },
    ]);
    await expect(resolveLocatorChain({} as Page, frame, chain)).resolves.toEqual([
      { frame, backendNodeId: 3 },
    ]);
    expect(send.mock.calls.filter(([method]) => method === "Runtime.releaseObject")).toEqual([
      ["Runtime.releaseObject", { objectId: "card-1" }],
      ["Runtime.releaseObject", { objectId: "card-2" }],
      ["Runtime.releaseObject", { objectId: "button" }],
    ]);
  });

  it("releases handles when a scoped query fails", async () => {
    const send = vi.fn(async (method: string) => {
      if (method === "DOM.describeNode")
        return { node: { backendNodeId: 2, localName: "section" } };
      if (method === "Runtime.callFunctionOn")
        return {
          result: { objectId: "error-object" },
          exceptionDetails: { text: "Invalid selector" },
        };
      return {};
    });
    const frame = { frameId: "root", session: { send } } as unknown as Frame;
    vi.spyOn(FrameSelectorResolver.prototype, "resolveAll").mockResolvedValue([
      { objectId: "card-1", nodeId: null },
      { objectId: "card-2", nodeId: null },
    ]);
    // Both handles describe the same element; deduplication happens before nth.
    const plan: LocatorChain = { steps: [{ ...chain.steps[0]!, nth: 0 }, chain.steps[1]!] };
    await expect(resolveLocatorChain({} as Page, frame, plan)).rejects.toThrow("Invalid selector");
    for (const objectId of ["card-1", "card-2", "error-object"]) {
      expect(send).toHaveBeenCalledWith("Runtime.releaseObject", { objectId });
    }
  });

  it("cleans up a query result arriving after the operation deadline", async () => {
    let complete: (value: unknown) => void = () => {};
    const pending = new Promise((resolve) => {
      complete = resolve;
    });
    const send = vi.fn(async (method: string) => {
      if (method === "DOM.describeNode")
        return { node: { backendNodeId: 2, localName: "section" } };
      if (method === "Runtime.callFunctionOn") return pending;
      return {};
    });
    const frame = { frameId: "root", session: { send } } as unknown as Frame;
    vi.spyOn(FrameSelectorResolver.prototype, "resolveAll").mockResolvedValue([
      { objectId: "card-2", nodeId: null },
    ]);
    const progress = new Progress("chain", 20);
    const plan: LocatorChain = { steps: [{ ...chain.steps[0]!, nth: 0 }, chain.steps[1]!] };
    try {
      await expect(resolveLocatorChain({} as Page, frame, plan, progress)).rejects.toThrow(
        /timed out/,
      );
      expect(send).toHaveBeenCalledWith("Runtime.releaseObject", { objectId: "card-2" });
      complete({ result: { objectId: "late-button" } });
      await vi.waitFor(() =>
        expect(send).toHaveBeenCalledWith("Runtime.releaseObject", { objectId: "late-button" }),
      );
    } finally {
      progress.dispose();
    }
  });
});
