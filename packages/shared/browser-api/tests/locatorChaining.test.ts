import { readFileSync } from "node:fs";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { locatorSteps } from "@browserbasehq/stagehand-protocol/locatorSelectors";
import { StagehandMethods } from "@browserbasehq/stagehand-protocol/schema-registry";
import type { StagehandCommandClient } from "../src/commandClient.js";
import { serializeClientLocatorOptions } from "../src/clientLocatorOptions.js";
import { Locator } from "../src/locator.js";
import { Page } from "../src/page.js";

const fixtures = JSON.parse(
  readFileSync(
    new URL(
      "../../../protocol/tests/fixtures/locator-selector-normalization.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as Array<{ selector: string; steps: string[][] }>;
const query = (value: string) => ({ type: "query", selector: { kind: "css", value } });

function fixture() {
  const send = vi.fn().mockResolvedValue(2);
  const page = new Page({ send, onNotification: () => () => {} } as StagehandCommandClient, {
    pageId: "p",
  });
  return { page, send };
}

describe("public locator chaining", () => {
  it("constructs typed text queries on pages & positioned locators", async () => {
    const { page, send } = fixture();
    const text = (value: string, exact = false) => ({
      type: "query",
      selector: { kind: "textMatch", value, exact },
    });
    const root = page.getByText("Save >> now", { exact: true });
    expectTypeOf(root).toEqualTypeOf<Locator>();
    expect(root.descriptor).toEqual({ pageId: "p", chain: { steps: [text("Save >> now", true)] } });
    const cards = page.locator(".card").nth(1);
    const scoped = cards.getByText("").nth(2).locator("span").getByText("label");
    expect(scoped.descriptor).toEqual({
      pageId: "p",
      chain: {
        steps: [
          query(".card"),
          { type: "nth", index: 1 },
          text(""),
          { type: "nth", index: 2 },
          query("span"),
          text("label"),
        ],
      },
    });
    expect(cards.descriptor).toEqual({ pageId: "p", selector: ".card", nth: 1 });
    expect(send).not.toHaveBeenCalled();
    await root.click({ timeout: 0 });
    expect(send).toHaveBeenLastCalledWith(StagehandMethods.locatorClick, {
      ...root.descriptor,
      options: { timeout: 0 },
    });
    expect(await scoped.count()).toBe(2);
    for (const invalid of [/Save/, { text: "Save" }, null, 42]) {
      expect(() => page.getByText(invalid as never)).toThrow();
      expect(() => cards.getByText(invalid as never)).toThrow();
    }
    expect(() => page.getByText("Save", { exact: "true" } as never)).toThrow();
    expect(() => cards.getByText("Save", { unexpected: true } as never)).toThrow();
  });

  it.each(fixtures)("normalizes $selector with the legacy routing rules", ({ selector, steps }) => {
    expect(
      locatorSteps(selector).map((step) => {
        if (step.type === "nth") throw new Error("Unexpected position");
        return [step.type, step.selector.kind, step.selector.value];
      }),
    ).toEqual(steps);
  });

  it("keeps branches independent & preserves positions between queries", () => {
    const { page, send } = fixture();
    const cards = page.locator(".card").nth(1);
    const buttons = cards.locator("button");
    const selected = buttons.nth(2).first();
    expectTypeOf(selected).toEqualTypeOf<Locator>();
    expect(cards.descriptor).toEqual({ pageId: "p", selector: ".card", nth: 1 });
    const steps = [query(".card"), { type: "nth", index: 1 }, query("button")];
    expect(buttons.descriptor).toEqual({ pageId: "p", chain: { steps } });
    expect(selected.descriptor).toEqual({
      pageId: "p",
      chain: { steps: [...steps, { type: "nth", index: 2 }, { type: "nth", index: 0 }] },
    });
    expect(cards.locator("input").descriptor).toEqual({
      pageId: "p",
      chain: { steps: [...steps.slice(0, 2), query("input")] },
    });
    expect(send).not.toHaveBeenCalled();
    for (const index of [-1, 1.5, NaN, Infinity]) expect(() => buttons.nth(index)).toThrow();
    expect(() => buttons.locator(" ")).toThrow();
  });

  it("preserves explicit hops, action options & scalar results in requests", async () => {
    const { page, send } = fixture();
    const locator = page.locator("iframe >> .card").nth(1).locator("iframe >> button");
    expect(locator.descriptor).toEqual({
      pageId: "p",
      chain: {
        steps: [
          query("iframe"),
          { type: "frame", selector: { kind: "css", value: ".card" } },
          { type: "nth", index: 1 },
          query("iframe"),
          { type: "frame", selector: { kind: "css", value: "button" } },
        ],
      },
    });
    const click = locator.click({ button: "right", timeout: 0 });
    expectTypeOf(click).toEqualTypeOf<Promise<void>>();
    await click;
    expect(send).toHaveBeenLastCalledWith(StagehandMethods.locatorClick, {
      ...locator.descriptor,
      options: { button: "right", timeout: 0 },
    });
    expect(await locator.count({ timeout: 1000 })).toBe(2);
    expect(send).toHaveBeenLastCalledWith(StagehandMethods.locatorCount, {
      ...locator.descriptor,
      options: { timeout: 1000 },
    });
    await page.locator("iframe >> button").nth(1).count();
    expect(send).toHaveBeenLastCalledWith(StagehandMethods.locatorCount, {
      pageId: "p",
      selector: "iframe >> button",
      nth: 1,
    });
  });

  it("serializes scopes, exclusions & masks without discarding the chain", async () => {
    const { page, send } = fixture();
    const locator = page.locator("iframe").locator("section");
    const chain = { steps: [query("iframe"), query("section")] };
    for (const method of ["act", "observe", "extract"]) {
      expect(
        serializeClientLocatorOptions(method, "p", {
          locator,
          ignoreLocators: [locator],
          timeout: 100,
        }),
      ).toEqual({ locator: { chain }, ignoreLocators: [{ chain }], timeout: 100 });
      expect(() => serializeClientLocatorOptions(method, "other", { locator })).toThrow(
        "target page",
      );
    }
    send.mockResolvedValue({ data: "" });
    await page.screenshot({ mask: [locator] });
    expect(send).toHaveBeenLastCalledWith(StagehandMethods.pageScreenshot, {
      pageId: "p",
      options: { mask: [{ pageId: "p", chain }] },
    });
  });
});
