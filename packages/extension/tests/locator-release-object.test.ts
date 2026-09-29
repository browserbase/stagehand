import { describe, expect, it, vi } from "vitest";
import type { CDPSessionLike } from "../understudy/cdp.js";
import type { Frame } from "../understudy/frame.js";
import { Locator } from "../understudy/locator.js";

const CONTEXT_GONE = new Error("-32000 Cannot find context with specified id");

function createLocator(callFunctionOn: () => Promise<unknown>): {
  locator: Locator;
  send: ReturnType<typeof vi.fn>;
} {
  const send = vi.fn(async (method: string): Promise<unknown> => {
    if (method === "Runtime.callFunctionOn") return await callFunctionOn();
    if (method === "Runtime.releaseObject") throw CONTEXT_GONE;
    return {};
  });
  const session = { id: "session", send } as unknown as CDPSessionLike;
  const frame = { session } as unknown as Frame;
  const locator = new Locator(frame, "xpath=/html/body/select");
  vi.spyOn(locator, "resolveNode").mockResolvedValue({ objectId: "obj-1" } as never);
  return { locator, send };
}

describe("Locator handle cleanup", () => {
  it("returns the selected values when the page navigates before the handle is released", async () => {
    const { locator, send } = createLocator(async () => ({ result: { value: ["b"] } }));

    await expect(locator.selectOption("b")).resolves.toEqual(["b"]);
    expect(send).toHaveBeenCalledWith("Runtime.releaseObject", { objectId: "obj-1" });
  });

  it("finishes typing when the page navigates before the handle is released", async () => {
    const { locator } = createLocator(async () => ({ result: { value: true } }));

    await expect(locator.type("hello")).resolves.toBeUndefined();
  });

  it.each([
    "isVisible",
    "isChecked",
    "inputValue",
    "textContent",
    "innerHtml",
    "innerText",
  ] as const)("%s returns its value when the handle release fails", async (method) => {
    const { locator } = createLocator(async () => ({ result: { value: "x" } }));

    await expect(locator[method]()).resolves.toBeDefined();
  });

  it("keeps the original error when the handle release also fails", async () => {
    const failure = new Error("select failed");
    const { locator } = createLocator(async () => {
      throw failure;
    });

    await expect(locator.selectOption("b")).rejects.toBe(failure);
  });
});
