import { describe, expect, it, vi } from "vitest";
import { evaluateWithShadowRoots } from "../understudy/shadowRootEvaluation.js";

describe("main-world shadow-root evaluation", () => {
  it("uses ordinary main-world evaluation when there are no author closed roots", async () => {
    const send = vi.fn().mockResolvedValue({
      root: { backendNodeId: 1, shadowRoots: [{ backendNodeId: 2, shadowRootType: "user-agent" }] },
    });
    const evaluate = vi.fn().mockResolvedValue(42);
    await expect(
      evaluateWithShadowRoots({ send } as never, evaluate, "roots => roots.length"),
    ).resolves.toBe(42);
    expect(evaluate).toHaveBeenCalledWith("(roots => roots.length)([])");
    expect(send).toHaveBeenCalledOnce();
  });

  it.each(["DOM.resolveNode", "Runtime.callFunctionOn"])(
    "releases references after %s fails",
    async (failureMethod) => {
      let resolved = 0;
      const send = vi.fn(async (method: string) => {
        if (method === "DOM.getDocument")
          return {
            root: {
              backendNodeId: 1,
              shadowRoots: [
                { backendNodeId: 2, shadowRootType: "closed" },
                { backendNodeId: 3, shadowRootType: "closed" },
              ],
            },
          };
        if (method === "DOM.resolveNode") {
          resolved += 1;
          if (method === failureMethod && resolved === 2) throw new Error("detached");
          return { object: { objectId: `root-${resolved}` } };
        }
        if (method === failureMethod) throw new Error("detached");
        return {};
      });
      await expect(
        evaluateWithShadowRoots({ send } as never, vi.fn(), "roots => roots.length"),
      ).rejects.toThrow("detached");
      expect(send.mock.calls.at(-1)?.[0]).toBe("Runtime.releaseObjectGroup");
    },
  );
});
