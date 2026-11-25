import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { StagehandMethods } from "../../schema-registry.js";
import { encodeWireValue, wireSchema } from "../../json-rpc/wire-casing.js";
import {
  ActionSchema,
  ActOptionsSchema,
  ExtractOptionsSchema,
  LocatorChainSchema,
  LocatorDescriptorSchema,
  LocatorInputSchema,
  LocatorRequestDescriptorSchema,
  LocatorSchema,
  ObserveOptionsSchema,
  PageScreenshotOptionsSchema,
} from "../../schemas.js";
import { invalidLocatorChains, validLocatorChains } from "../fixtures/locator-chains.js";

describe("locator chain validation", () => {
  it.each(validLocatorChains)("preserves $name", ({ chain }) => {
    expect(encodeWireValue(wireSchema(LocatorChainSchema).parse(chain))).toStrictEqual(chain);
  });

  it.each(invalidLocatorChains)("rejects $name", ({ chain }) => {
    expect(wireSchema(LocatorChainSchema).safeParse(chain).success).toBe(false);
  });

  it.each([NaN, Infinity])("rejects non-finite position %s", (index) => {
    const steps = [...validLocatorChains[0]!.chain.steps, { type: "nth", index }];
    expect(LocatorChainSchema.safeParse({ steps }).success).toBe(false);
  });
});

const chain = validLocatorChains[0]!.chain;
const legacyLocators = [
  { selector: "button" },
  { selector: "iframe.checkout >> button", nth: 2 },
  { selector: "xpath=//button[1]", nth: 0 },
  { selector: 'text="Save"' },
];
const requiredFields: Record<string, Record<string, unknown>> = {
  "locator.fill": { value: "hello" },
  "locator.scroll_to": { percent: "bottom" },
  "locator.type": { text: "hello" },
  "locator.select_option": { values: ["a"] },
  "locator.set_input_files": { files: [{ name: "hello.txt", data: "aGVsbG8=" }] },
};

describe("released locator wire compatibility", () => {
  const methods = Object.values(StagehandMethods).filter((method) =>
    method.name.startsWith("locator."),
  );

  it.each(methods)("accepts legacy & chain requests for $name", ({ name, params }) => {
    const schema = wireSchema(params);
    const required = { page_id: "page-1", ...requiredFields[name] };
    for (const locator of legacyLocators) {
      const input = { ...required, ...locator };
      expect(encodeWireValue(schema.parse(input))).toStrictEqual(input);
      expect(schema.safeParse({ ...input, chain }).success).toBe(false);
    }
    expect(encodeWireValue(schema.parse({ ...required, chain }))).toStrictEqual({
      ...required,
      chain,
    });
    expect(schema.safeParse({ ...required, chain, nth: 0 }).success).toBe(false);
  });

  it.each(legacyLocators)(
    "preserves scope, exclusion, and mask inputs for $selector",
    (locator) => {
      const descriptor = { pageId: "page-1", ...locator };
      expect(LocatorSchema.parse(locator)).toStrictEqual(locator);
      expect(LocatorInputSchema.parse({ chain })).toStrictEqual({ chain });
      expect(LocatorRequestDescriptorSchema.parse({ pageId: "page-1", chain })).toStrictEqual({
        pageId: "page-1",
        chain,
      });
      expect(LocatorDescriptorSchema.parse(descriptor)).toStrictEqual(descriptor);
      for (const schema of [ActOptionsSchema, ObserveOptionsSchema, ExtractOptionsSchema]) {
        const options = { locator, ignoreLocators: [locator] };
        expect(schema.parse(options)).toStrictEqual(options);
        expect(schema.parse({ locator: { chain } })).toStrictEqual({ locator: { chain } });
        expect(schema.parse({ ignoreLocators: [{ chain }] })).toStrictEqual({
          ignoreLocators: [{ chain }],
        });
        expect(schema.safeParse({ locator: { ...locator, chain } }).success).toBe(false);
        expect(schema.safeParse({ ignoreLocators: [{ ...locator, chain }] }).success).toBe(false);
      }
      expect(PageScreenshotOptionsSchema.parse({ mask: [descriptor] })).toStrictEqual({
        mask: [descriptor],
      });
      expect(
        PageScreenshotOptionsSchema.safeParse({ mask: [{ pageId: "page-1", chain }] }).success,
      ).toBe(true);
      expect(
        PageScreenshotOptionsSchema.safeParse({ mask: [{ ...descriptor, chain }] }).success,
      ).toBe(false);
    },
  );

  it("keeps action results as string selectors", () => {
    const action = {
      selector: "xpath=//button",
      description: "Save",
      method: "click",
      arguments: [],
    };
    expect(ActionSchema.parse(action)).toStrictEqual(action);
    expect(ActionSchema.safeParse({ ...action, chain }).success).toBe(false);
    expect(ActionSchema.safeParse({ description: "Save", chain }).success).toBe(false);
  });

  it("advertises chain requests in the generated protocol", () => {
    const protocol = JSON.parse(
      readFileSync(new URL("../../stagehand.v4.json", import.meta.url), "utf8"),
    ) as {
      $defs: Record<string, unknown>;
    };
    for (const name of [
      "LocatorChain",
      "LocatorStep",
      "LocatorQueryStep",
      "LocatorQuerySelector",
      "LocatorFrameStep",
      "LocatorNthStep",
      "LocatorFilterStep",
    ]) {
      expect(protocol.$defs).toHaveProperty(name);
    }
  });
});
