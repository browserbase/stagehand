import { describe, expect, it } from "vitest";
import { PageApcOptionsSchema, PageApcParamsSchema, PageApcResultSchema } from "../../schemas.js";
import { StagehandMethods } from "../../schema-registry.js";
import { encodeWireValue, wireSchema } from "../../json-rpc/wire-casing.js";

describe("page.apc protocol", () => {
  it("preserves omitted and empty filters and allows zero or fractional timeouts", () => {
    expect(PageApcParamsSchema.parse({ pageId: "page-1" })).toEqual({ pageId: "page-1" });
    for (const options of [
      {},
      { actions: [], timeout: 0 },
      {
        actions: ["click", "fill", "type", "select", "hover", "scroll", "upload"],
        timeout: 100.5,
      },
    ]) {
      expect(PageApcOptionsSchema.parse(options)).toEqual(options);
    }
  });

  it("round-trips wire casing without modifying the formatted text", () => {
    const api = { pageId: "page-1", options: { actions: ["fill", "select"], timeout: 250 } };
    const wire = { page_id: "page-1", options: api.options };
    expect(encodeWireValue(api)).toEqual(wire);
    expect(wireSchema(StagehandMethods.pageApc.params).parse(wire)).toEqual(api);
    for (const tree of ['root\n  [apc-2] input_text [name="firstName"]', ""]) {
      expect(PageApcResultSchema.parse(tree)).toBe(tree);
      expect(encodeWireValue(tree)).toBe(tree);
      expect(wireSchema(StagehandMethods.pageApc.result).parse(tree)).toBe(tree);
    }
  });

  it("rejects invalid action names and invalid deadlines", () => {
    expect(PageApcOptionsSchema.safeParse({ actions: ["invalid"] }).success).toBe(false);
    for (const timeout of [-1, Infinity, NaN]) {
      expect(PageApcOptionsSchema.safeParse({ timeout }).success).toBe(false);
    }
  });
});
