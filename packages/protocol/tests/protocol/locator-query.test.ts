import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  decodeLocatorQuery,
  encodeLocatorQuery,
  AriaRoleSchema,
  GetByRoleOptionsSchema,
  GetByTextOptionsSchema,
  type QueryStep,
} from "../../locator-query.js";

describe("semantic locator query contract", () => {
  it("matches Playwright's 82 public getByRole role names", () => {
    expect(AriaRoleSchema.options).toHaveLength(82);
    expect(AriaRoleSchema.safeParse("mark").success).toBe(false);
  });
  it("round-trips a typed query through normal wire casing", () => {
    const query: QueryStep[] = [
      { kind: "selector", selector: "iframe >> section" },
      { kind: "nth", index: 0 },
      { kind: "role", role: "button", options: { name: /draft/i.source, includeHidden: true } },
      { kind: "text", text: { source: "draft >> publish", flags: "i" }, exact: true },
    ];
    const encoded = encodeLocatorQuery(query);
    expect(encoded).toContain('"include_hidden":true');
    expect(decodeLocatorQuery(encoded)).toEqual(query);
  });

  it("rejects malformed reserved envelopes without treating them as CSS selectors", () => {
    expect(decodeLocatorQuery("button >> text=Save")).toBeNull();
    for (const value of [
      "not-json",
      "null",
      "[]",
      '[{"kind":"nth","index":0}]',
      '[{"kind":"unknown"}]',
    ]) {
      expect(() => decodeLocatorQuery(`internal:locator=${value}`)).toThrow(
        "Invalid semantic locator query",
      );
    }
  });

  it("rejects invalid native regex syntax, flags, and nested envelopes", () => {
    expect(() => encodeLocatorQuery([{ kind: "text", text: { source: "[" } }])).toThrow();
    expect(() =>
      encodeLocatorQuery([{ kind: "text", text: { source: "x", flags: "ii" } }]),
    ).toThrow();
    expect(() =>
      encodeLocatorQuery([
        { kind: "selector", selector: 'internal:locator=[{"kind":"text","text":"x"}]' },
      ]),
    ).toThrow();
  });

  it.each([
    ['[{"kind":"text","text":{"source":"["}}]', "Invalid regular expression"],
    ['[{"kind":"role","role":"heading","options":{"level":0}}]', "level"],
  ])("keeps the validation reason and cause for %s", (query, reason) => {
    let error: unknown;
    try {
      decodeLocatorQuery(`internal:locator=${query}`);
    } catch (caught) {
      error = caught;
    }
    if (!(error instanceof Error)) throw new Error("Expected a semantic locator validation error");
    expect(error.constructor).toBe(Error);
    expect(error).toMatchObject({
      message: expect.stringContaining(`Invalid semantic locator query: `),
      cause: expect.any(Error),
    });
    expect(error).toHaveProperty("message", expect.stringContaining(reason));
  });

  it("omits undefined optional fields before encoding JSON", () => {
    expect(
      decodeLocatorQuery(
        encodeLocatorQuery([
          { kind: "role", role: "button", options: undefined },
          { kind: "text", text: { source: "x", flags: undefined }, exact: undefined },
        ]),
      ),
    ).toEqual([
      { kind: "role", role: "button" },
      { kind: "text", text: { source: "x" } },
    ]);
  });

  it("keeps the public role states boolean and rejects undeclared option fields", () => {
    expect(GetByRoleOptionsSchema.safeParse({ checked: "mixed" }).success).toBe(false);
    expect(GetByRoleOptionsSchema.safeParse({ pressed: "mixed" }).success).toBe(false);
    expect(GetByRoleOptionsSchema.safeParse({ include_hidden: true }).success).toBe(false);
    expect(GetByTextOptionsSchema.safeParse({ includeHidden: true }).success).toBe(false);
  });

  it("publishes generated builder models without adding RPC methods", async () => {
    const document = JSON.parse(
      await readFile(new URL("../../stagehand.v4.json", import.meta.url), "utf8"),
    );
    expect(document.properties.locator_builder_models).toBeDefined();
    expect(document.$defs.GetByRoleOptions.properties.include_hidden).toEqual({ type: "boolean" });
    expect(document.$defs.GetByRoleOptions.properties.includeHidden).toBeUndefined();
    expect(document.$defs.SemanticLocatorQuery.items).toEqual({ $ref: "#/$defs/QueryStep" });
    expect(Object.keys(document.properties.methods.properties)).not.toContain("page.getByRole");
    expect(Object.keys(document.properties.methods.properties)).not.toContain("page.getByText");
  });
});
