import { afterEach, describe, expect, it, vi } from "vitest";
import { guardActionTarget } from "../services/decisions/actionGuard.js";
import { checkTargetInPage } from "../services/decisions/actionTarget.js";
import { resolveLocatorWithHops } from "../understudy/deepLocator.js";
import type { Page } from "../understudy/page.js";
import { Progress } from "../understudy/progress.js";

vi.mock("../understudy/deepLocator.js", () => ({ resolveLocatorWithHops: vi.fn() }));
afterEach(() => vi.restoreAllMocks());

function setup(verdict = "ok", nodeId = 12) {
  const send = vi.fn(async (method: string, params?: Record<string, unknown>) => {
    if (method === "DOM.describeNode") return { node: { backendNodeId: nodeId } };
    if (params?.functionDeclaration === checkTargetInPage.toString())
      return { result: { value: { verdict: "ok" } } };
    return method === "Runtime.callFunctionOn" ? { result: { value: verdict } } : {};
  });
  const locator = {
    backendNodeId: vi.fn(async () => nodeId),
    getFrame: () => ({ frameId: "main", session: { send } }),
    resolveNode: vi.fn(async () => ({ objectId: "input" })),
  };
  vi.mocked(resolveLocatorWithHops)
    .mockReset()
    .mockResolvedValue(locator as never);
  const page = { mainFrame: () => ({}), getOrdinal: () => 0 } as unknown as Page;
  const progress = new Progress("guard-test", 0);
  return { page, progress, send, locator };
}

describe("action execution eligibility", () => {
  it("rejects a replaced model target without reading or acting on the replacement", async () => {
    const { page, progress, locator, send } = setup("ok", 99);
    expect(
      await guardActionTarget(
        page,
        { selector: "input", method: "fill", description: "Field" },
        progress,
        "0-12",
      ),
    ).toBe("target_replaced");
    expect(locator.resolveNode).toHaveBeenCalledTimes(1);
    expect(locator.backendNodeId).not.toHaveBeenCalled();
    expect(send).toHaveBeenNthCalledWith(1, "DOM.describeNode", { objectId: "input" });
    expect(send).not.toHaveBeenCalledWith("Runtime.callFunctionOn", expect.anything());
    expect(send).toHaveBeenLastCalledWith("Runtime.releaseObject", { objectId: "input" });
  });
  it.each(["target_disabled", "target_readonly", "target_hidden", "target_not_editable"])(
    "returns %s and releases the remote node",
    async (verdict) => {
      const { page, progress, send } = setup(verdict);
      expect(
        await guardActionTarget(
          page,
          { selector: "input", method: "fill", description: "Field" },
          progress,
          "0-12",
        ),
      ).toBe(verdict);
      expect(send).toHaveBeenLastCalledWith("Runtime.releaseObject", { objectId: "input" });
    },
  );
  it("fails closed when the eligibility probe has no result", async () => {
    const { page, progress, send } = setup();
    send.mockResolvedValueOnce({} as never);
    expect(
      await guardActionTarget(
        page,
        { selector: "input", method: "fill", description: "Field" },
        progress,
      ),
    ).toBe("target_unresolved");
    expect(send).toHaveBeenLastCalledWith("Runtime.releaseObject", { objectId: "input" });
  });

  it("checks eligibility for a padded method the executor trims", async () => {
    const { page, progress } = setup("target_disabled");
    expect(
      await guardActionTarget(
        page,
        {
          selector: "button",
          method: " click ",
          description: "Submit",
        },
        progress,
      ),
    ).toBe("target_disabled");
  });

  it.each(["target_hidden", "target_disabled", "target_unresolved", "target_replaced"])(
    "rejects a drag destination with %s before input",
    async (verdict) => {
      const { page, progress, send, locator } = setup();
      locator.resolveNode
        .mockResolvedValueOnce({ objectId: "input" })
        .mockResolvedValueOnce({ objectId: "destination" });
      if (verdict === "target_unresolved") {
        vi.mocked(resolveLocatorWithHops)
          .mockResolvedValueOnce(locator as never)
          .mockRejectedValueOnce(new Error("Missing destination"));
      } else {
        const respond = send.getMockImplementation()!;
        send.mockImplementation(async (method, params) => {
          if (params?.objectId !== "destination") return respond(method, params);
          return method === "DOM.describeNode"
            ? { node: { backendNodeId: verdict === "target_replaced" ? 99 : 13 } }
            : { result: { value: verdict } };
        });
      }
      expect(
        await guardActionTarget(
          page,
          {
            selector: "#source",
            method: "dragAndDrop",
            arguments: ["#destination"],
            description: "Drag",
          },
          progress,
          "0-12",
          "0-13",
        ),
      ).toBe(`drag_destination_${verdict}`);
      expect(vi.mocked(resolveLocatorWithHops).mock.calls.map((call) => call[2])).toEqual([
        "#source",
        "#destination",
      ]);
    },
  );
});
