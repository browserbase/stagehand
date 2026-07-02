import { describe, expect, it, vi } from "vitest";

import { elementsHandlers } from "../src/lib/driver/commands/elements.js";

/**
 * Regression coverage: `browse click` / `browse fill` used to return
 * { clicked: true } / { filled: true } (exit 0) even when the selector matched
 * no element, because act() reports failure via success:false instead of
 * throwing. The sibling commands (select/upload) already throw via deepLocator.
 * These tests lock in that click/fill now surface the failure.
 */
type ClickManager = Parameters<
  NonNullable<(typeof elementsHandlers)["click"]>
>[0];

function managerWithActResult(actResult: {
  success: boolean;
  message: string;
}) {
  const act = vi.fn().mockResolvedValue(actResult);
  const keyPress = vi.fn();
  const manager = {
    stagehandInstance: async () => ({ act }),
    resolveSelector: (selector: string) => selector,
    activePage: async () => ({ keyPress }),
  } as unknown as ClickManager;
  return { manager, act, keyPress };
}

const NO_MATCH = {
  success: false,
  message: "Could not find an element for the given xPath(s): #missing",
};

describe("browse click/fill surface act failures instead of reporting success", () => {
  it("click throws when the underlying act reports failure (no-match selector)", async () => {
    const { manager } = managerWithActResult(NO_MATCH);
    await expect(
      elementsHandlers.click!(manager, { selector: "#missing" }),
    ).rejects.toThrow("Could not find an element");
  });

  it("click resolves { clicked: true } when the action succeeds", async () => {
    const { manager } = managerWithActResult({ success: true, message: "" });
    await expect(
      elementsHandlers.click!(manager, { selector: "#ok" }),
    ).resolves.toEqual({ clicked: true });
  });

  it("fill throws when the underlying act reports failure (no-match selector)", async () => {
    const { manager } = managerWithActResult(NO_MATCH);
    await expect(
      elementsHandlers.fill!(manager, { selector: "#missing", value: "hi" }),
    ).rejects.toThrow("Could not find an element");
  });

  it("fill resolves and does not press Enter when the action succeeds", async () => {
    const { manager, keyPress } = managerWithActResult({
      success: true,
      message: "",
    });
    await expect(
      elementsHandlers.fill!(manager, { selector: "#ok", value: "hi" }),
    ).resolves.toEqual({ filled: true, pressedEnter: false });
    expect(keyPress).not.toHaveBeenCalled();
  });

  it("fill does not press Enter when the action failed", async () => {
    const { manager, keyPress } = managerWithActResult(NO_MATCH);
    await expect(
      elementsHandlers.fill!(manager, {
        selector: "#missing",
        value: "hi",
        pressEnter: true,
      }),
    ).rejects.toThrow("Could not find an element");
    expect(keyPress).not.toHaveBeenCalled();
  });
});
