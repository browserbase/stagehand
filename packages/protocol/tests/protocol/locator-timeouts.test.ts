import { describe, expect, it } from "vitest";
import { StagehandMethods } from "../../schema-registry.js";
import { LocatorDescriptorSchema } from "../../schemas.js";

const descriptor = { pageId: "page-1", selector: "button", nth: 0 };
const requiredFields: Record<string, Record<string, unknown>> = {
  "locator.fill": { value: "hello" },
  "locator.scroll_to": { percent: "bottom" },
  "locator.type": { text: "hello" },
  "locator.select_option": { values: ["a", "b"] },
  "locator.set_input_files": { files: [{ name: "hello.txt", data: "aGVsbG8=" }] },
};
const locatorMethods = Object.values(StagehandMethods).filter((method) =>
  method.name.startsWith("locator."),
);

describe.each(locatorMethods)("$name timeout options", ({ name, params }) => {
  const input = { ...descriptor, ...requiredFields[name] };

  it("preserves omitted timeout settings without inserting a default", () => {
    expect(params.parse(input)).toStrictEqual(input);
    expect(params.parse({ ...input, options: {} })).toStrictEqual({ ...input, options: {} });
  });

  it.each([0, 0.5, 5_000, 20_000])("preserves timeout %s", (timeout) => {
    const request = { ...input, options: { timeout } };
    expect(params.parse(request)).toStrictEqual(request);
  });

  it.each([-1, NaN, Infinity, -Infinity, "5000", null])("rejects invalid timeout %s", (timeout) => {
    expect(params.safeParse({ ...input, options: { timeout } }).success).toBe(false);
  });
});

describe("locator timeout compatibility", () => {
  it.each([
    { method: StagehandMethods.locatorClick, options: { button: "right", clickCount: 2 } },
    { method: StagehandMethods.locatorType, options: { delay: 25 } },
    {
      method: StagehandMethods.locatorHighlight,
      options: {
        durationMs: 0,
        borderColor: { r: 255, g: 0, b: 0, a: 0.5 },
        contentColor: { r: 0, g: 255, b: 0 },
      },
    },
    {
      method: StagehandMethods.locatorSendClickEvent,
      options: { bubbles: true, cancelable: false, composed: true, detail: 2 },
    },
  ])("preserves existing $method.name options alongside timeout", ({ method, options }) => {
    const request = {
      ...descriptor,
      ...requiredFields[method.name],
      options: { ...options, timeout: 0 },
    };
    expect(method.params.parse(request)).toStrictEqual(request);
  });

  it("keeps timeout settings out of locator identity", () => {
    expect(LocatorDescriptorSchema.parse(descriptor)).toStrictEqual(descriptor);
    expect(
      LocatorDescriptorSchema.safeParse({ ...descriptor, options: { timeout: 0 } }).success,
    ).toBe(false);
    expect(LocatorDescriptorSchema.safeParse({ ...descriptor, timeout: 0 }).success).toBe(false);
  });
});
