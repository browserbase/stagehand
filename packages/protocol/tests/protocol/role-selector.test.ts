import { readFileSync } from "node:fs";
import { describe, expect, it, expectTypeOf } from "vitest";
import { LocatorChainSchema, RoleSelectorQuerySchema } from "../../schemas.js";
import type { AriaRole, GetByRoleOptions, RoleSelectorQuery } from "../../types.js";

const role = (value: unknown, options: object = {}) => ({ kind: "role", value, ...options });

describe("role query validation", () => {
  it.each([
    role("button", { name: "", exact: true, pressed: "mixed", disabled: false }),
    role("checkbox", { checked: "mixed" }),
    role("menuitemcheckbox", { checked: "mixed" }),
    role("radio", { checked: false }),
    role("option", { checked: true }),
    role("treeitem", { checked: "mixed" }),
    role("columnheader", { selected: true }),
    role("tab", { selected: true, expanded: false }),
    role("heading", { level: 3 }),
    role("treeitem", { level: 2, expanded: true, selected: false }),
    role("img", { name: "Diagram" }),
  ])("preserves $value queries", (selector) => {
    expect(RoleSelectorQuerySchema.parse(selector)).toEqual(selector);
    const chain = { steps: [{ type: "query", selector }] };
    expect(LocatorChainSchema.parse(chain)).toEqual(chain);
  });

  it.each([
    role("not-a-role"),
    role("Button"),
    role("widget"),
    role(""),
    role(42),
    role("button", { name: /Save/ }),
    role("button", { name: null }),
    role("button", { exact: "true" }),
    role("button", { checked: true }),
    role("radio", { checked: "mixed" }),
    role("switch", { checked: "mixed" }),
    role("menuitemradio", { checked: "mixed" }),
    role("checkbox", { pressed: false }),
    role("button", { selected: true }),
    role("img", { expanded: true }),
    role("button", { level: 1 }),
    role("heading", { level: 0 }),
    role("heading", { level: 1.5 }),
    role("heading", { level: Infinity }),
    role("tab", { selected: "mixed" }),
    role("button", { disabled: "false" }),
    role("button", { includeHidden: false }),
    role("button", { include_hidden: true }),
    role("button", { unknown: true }),
  ])("rejects unsupported roles & options: %j", (selector) => {
    expect(RoleSelectorQuerySchema.safeParse(selector).success).toBe(false);
    expect(LocatorChainSchema.safeParse({ steps: [{ type: "query", selector }] }).success).toBe(
      false,
    );
  });

  it("exposes a literal role union & typed options", () => {
    expectTypeOf<"button">().toExtend<AriaRole>();
    expectTypeOf<string>().not.toExtend<AriaRole>();
    expectTypeOf<RoleSelectorQuery>().toExtend<
      GetByRoleOptions & { kind: "role"; value: AriaRole }
    >();
    expectTypeOf<GetByRoleOptions["checked"]>().toEqualTypeOf<boolean | "mixed" | undefined>();
  });
});

const wireFixtures = JSON.parse(
  readFileSync(new URL("../fixtures/role-selector-wire.json", import.meta.url), "utf8"),
) as { valid: unknown[]; invalid: unknown[] };
describe("role selector wire fixtures shared with Python", () => {
  it.each(wireFixtures.valid)("preserves %j", (selector) => {
    expect(RoleSelectorQuerySchema.parse(selector)).toEqual(selector);
  });
  it.each(wireFixtures.invalid)("rejects %j", (selector) => {
    expect(RoleSelectorQuerySchema.safeParse(selector).success).toBe(false);
  });
});
