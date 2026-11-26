import { readFileSync } from "node:fs";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { locatorSteps } from "@browserbasehq/stagehand-protocol/locatorSelectors";
import type { RoleSelectorQuery } from "@browserbasehq/stagehand-protocol/types";
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
const roleFixtures = JSON.parse(
  readFileSync(
    new URL("../../../protocol/tests/fixtures/role-selector-wire.json", import.meta.url),
    "utf8",
  ),
) as { valid: RoleSelectorQuery[] };
const query = (value: string) => ({ type: "query", selector: { kind: "css", value } });

function fixture() {
  const send = vi.fn().mockResolvedValue(2);
  const page = new Page({ send, onNotification: () => () => {} } as StagehandCommandClient, {
    pageId: "p",
  });
  return { page, send };
}

describe("public locator chaining", () => {
  it("builds lazy text filters with independent branches & ordered positions", async () => {
    const { page, send } = fixture();
    const cards = page.locator(".card");
    const options = { hasText: " Billing >> 保存 ", hasNotText: "Archived" };
    const filter = { type: "filter", ...options };
    const filtered = cards.filter(options);
    expectTypeOf(filtered).toEqualTypeOf<Locator>();
    options.hasText = "changed";
    expect(filtered.descriptor).toEqual({
      pageId: "p",
      chain: { steps: [query(".card"), filter] },
    });
    expect(cards.descriptor).toEqual({ pageId: "p", selector: ".card" });
    expect(cards.nth(1).filter({ hasText: "Billing" }).descriptor).toEqual({
      pageId: "p",
      chain: {
        steps: [query(".card"), { type: "nth", index: 1 }, { type: "filter", hasText: "Billing" }],
      },
    });
    const branch = filtered
      .nth(1)
      .filter({ hasNotText: "Draft" })
      .locator("button")
      .getByText("Save");
    expect(branch.descriptor).toEqual({
      pageId: "p",
      chain: {
        steps: [
          query(".card"),
          filter,
          { type: "nth", index: 1 },
          { type: "filter", hasNotText: "Draft" },
          query("button"),
          { type: "query", selector: { kind: "textMatch", value: "Save", exact: false } },
        ],
      },
    });
    expect(filtered.descriptor).toEqual({
      pageId: "p",
      chain: { steps: [query(".card"), filter] },
    });
    expect(send).not.toHaveBeenCalled();
    await filtered.click({ timeout: 0 });
    expect(send).toHaveBeenLastCalledWith(StagehandMethods.locatorClick, {
      ...filtered.descriptor,
      options: { timeout: 0 },
    });
    expect(await branch.count()).toBe(2);
    expect(send).toHaveBeenLastCalledWith(StagehandMethods.locatorCount, branch.descriptor);
  });

  it.each([{}, { hasText: "" }, { hasNotText: "" }, { hasText: "", hasNotText: "" }])(
    "preserves empty filter options %j",
    (options) => {
      const { page, send } = fixture();
      const cards = page.locator(".card");
      expect(cards.filter(options).descriptor).toEqual({
        pageId: "p",
        chain: { steps: [query(".card"), { type: "filter", ...options }] },
      });
      expect(cards.filter().descriptor).toEqual(cards.filter({}).descriptor);
      expect(send).not.toHaveBeenCalled();
    },
  );

  it("rejects unsupported filters before dispatch", () => {
    const { page, send } = fixture();
    const cards = page.locator(".card");
    for (const options of [
      null,
      "Billing",
      [],
      { has: cards },
      { hasNot: cards },
      { exact: true },
      { type: "nth" },
    ]) {
      expect(() => cards.filter(options as never)).toThrow();
    }
    for (const key of ["hasText", "hasNotText"]) {
      for (const value of [/Billing/, null, 42, false, { text: "Billing" }]) {
        expect(() => cards.filter({ [key]: value } as never)).toThrow();
      }
    }
    expect(send).not.toHaveBeenCalled();
  });

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

  it("builds lazy role queries & preserves scopes, options, positions & independent branches", async () => {
    const { page, send } = fixture();
    const root = page.getByRole("button", { name: "Save >> now", exact: true, disabled: false });
    expectTypeOf(root).toEqualTypeOf<Locator>();
    const role = {
      type: "query",
      selector: {
        kind: "role",
        value: "button",
        name: "Save >> now",
        exact: true,
        disabled: false,
      },
    };
    const nested = root.getByRole("checkbox", { checked: "mixed" });
    expect(nested.descriptor).toEqual({
      pageId: "p",
      chain: {
        steps: [
          role,
          { type: "query", selector: { kind: "role", value: "checkbox", checked: "mixed" } },
        ],
      },
    });
    expect(root.descriptor).toEqual({ pageId: "p", chain: { steps: [role] } });
    const cards = page.locator(".card").nth(1);
    const scoped = cards
      .getByRole("button", { name: "Save >> now", exact: true, disabled: false })
      .nth(2)
      .locator("span")
      .getByText("label");
    expect(scoped.descriptor).toEqual({
      pageId: "p",
      chain: {
        steps: [
          query(".card"),
          { type: "nth", index: 1 },
          role,
          { type: "nth", index: 2 },
          query("span"),
          { type: "query", selector: { kind: "textMatch", value: "label", exact: false } },
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
    expect(
      serializeClientLocatorOptions("observe", "p", { locator: root, ignoreLocators: [scoped] }),
    ).toEqual({
      locator: { chain: (root.descriptor as { chain: unknown }).chain },
      ignoreLocators: [{ chain: (scoped.descriptor as { chain: unknown }).chain }],
    });
    for (const role of ["Button", "fake", 42, null]) {
      expect(() => page.getByRole(role as never)).toThrow();
      expect(() => cards.getByRole(role as never)).toThrow();
    }
    for (const options of [
      { checked: true },
      { name: /Save/ },
      { name: null },
      { pressed: null },
      { exact: "true" },
      { includeHidden: false },
      { unexpected: true },
      { value: "link" },
    ]) {
      expect(() => page.getByRole("button", options as never)).toThrow();
      expect(() => cards.getByRole("button", options as never)).toThrow();
    }
    expect(send).toHaveBeenCalledTimes(2);
  });

  it.each(roleFixtures.valid)("serializes supported role options: %j", async (selector) => {
    const { page, send } = fixture();
    const { kind: _kind, value, ...options } = selector;
    for (const scope of [page, page.locator(".scope")]) {
      const locator = scope.getByRole(value, options);
      await locator.count();
      expect(send).toHaveBeenLastCalledWith(StagehandMethods.locatorCount, {
        pageId: "p",
        chain: {
          steps: [...(scope === page ? [] : [query(".scope")]), { type: "query", selector }],
        },
      });
    }
  });

  it.each(fixtures)("normalizes $selector with the legacy routing rules", ({ selector, steps }) => {
    expect(
      locatorSteps(selector).map((step) => {
        if (step.type !== "query" && step.type !== "frame") throw new Error("Unexpected step");
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
