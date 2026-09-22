import { describe, expect, it, vi } from "vitest";
import { StagehandMethods } from "@browserbasehq/stagehand-protocol/schema-registry";
import { Locator } from "../src/locator.js";
import type { LocatorOptions } from "../src/locator.js";
import type { StagehandCommandClient } from "../src/commandClient.js";
import { rpcResponseTimeoutMs } from "../src/rpcClient.js";

const calls: Array<
  [
    string,
    (locator: Locator, options?: LocatorOptions) => Promise<unknown>,
    Record<string, unknown>,
  ]
> = [
  ["click", (l, o) => l.click({ button: "right", ...o }), { options: { button: "right" } }],
  ["hover", (l, o) => l.hover(o), {}],
  ["fill", (l, o) => l.fill("hello", o), { value: "hello" }],
  [
    "type",
    (l, o) => l.type("hello", { delay: 25, ...o }),
    { text: "hello", options: { delay: 25 } },
  ],
  ["select_option", (l, o) => l.selectOption("one", o), { values: "one" }],
  ["set_input_files", (l, o) => l.setInputFiles([], o), { files: [] }],
  ["scroll_to", (l, o) => l.scrollTo(50, o), { percent: 50 }],
  [
    "send_click_event",
    (l, o) => l.sendClickEvent({ bubbles: false, ...o }),
    { options: { bubbles: false } },
  ],
  ["inner_text", (l, o) => l.innerText(o), {}],
  ["inner_html", (l, o) => l.innerHtml(o), {}],
  ["text_content", (l, o) => l.textContent(o), {}],
  ["input_value", (l, o) => l.inputValue(o), {}],
  ["is_checked", (l, o) => l.isChecked(o), {}],
  ["centroid", (l, o) => l.centroid(o), {}],
  ["count", (l, o) => l.count(o), {}],
  ["is_visible", (l, o) => l.isVisible(o), {}],
  ["highlight", (l, o) => l.highlight({ durationMs: 100, ...o }), { options: { durationMs: 100 } }],
];

describe.each(calls)("locator.%s timeout", (name, invoke, fields) => {
  it.each([undefined, 0, 15000])("forwards %s and preserves other options", async (timeout) => {
    const send = vi.fn().mockResolvedValue(undefined);
    const client = { send, onNotification: vi.fn() } as StagehandCommandClient;
    const descriptor = { pageId: "page", selector: "iframe >> button", nth: 2 };
    await invoke(new Locator(client, descriptor), timeout === undefined ? undefined : { timeout });
    const [method, params] = send.mock.calls[0]!;
    expect(method.name).toBe(`locator.${name}`);
    const expected: Record<string, unknown> = { ...descriptor, ...fields };
    if (timeout !== undefined) expected.options = { ...(fields.options as object), timeout };
    expect(params).toEqual(expected);
    const parsed = method.params.parse(params);
    expect(parsed.options.timeout).toBe(timeout ?? 5000);
    expect(rpcResponseTimeoutMs(method.name, parsed)).toBe(
      timeout === 0 ? undefined : (timeout ?? 5000) + 10000,
    );
  });
});

it("defaults all 17 methods when the entire options object is omitted", () => {
  const methods = Object.values(StagehandMethods).filter((m) => m.name.startsWith("locator."));
  expect(methods).toHaveLength(17);
  for (const method of methods) {
    const fields = calls.find(([name]) => `locator.${name}` === method.name)![2];
    const { options: _, ...required } = fields;
    expect(method.params.parse({ pageId: "page", selector: "button", ...required })).toMatchObject({
      options: { timeout: 5000 },
    });
    expect(rpcResponseTimeoutMs(method.name, {})).toBe(15000);
    for (const timeout of [-1, NaN, Infinity, 1.5]) {
      expect(
        method.params.safeParse({
          pageId: "page",
          selector: "button",
          ...required,
          options: { timeout },
        }).success,
      ).toBe(false);
    }
  }
});
