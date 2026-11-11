import { StagehandMethods } from "../../schema-registry.js";
import { describe, expect, it } from "vitest";
import { z } from "zod/v4";
import { LocatorChainSchema } from "../../schemas.js";
import type { LocatorChain } from "../../types.js";

describe("locator chain query plans", () => {
  it("accepts chains in actions, scopes, exclusions, and screenshot masks", () => {
    const selector = {
      steps: [
        { type: "query", selector: { type: "css", value: ".card" }, nth: 1 },
        { type: "query", selector: { type: "text", value: "Pay" } },
      ],
    };
    const action = { pageId: "page-1", selector };
    expect(StagehandMethods.locatorClick.params.parse(action)).toEqual(action);
    const observe = {
      pageId: "page-1",
      options: {
        locator: { selector },
        ignoreLocators: [{ selector }],
      },
    };
    expect(StagehandMethods.stagehandObserve.params.parse(observe)).toEqual(observe);
    const screenshot = { pageId: "page-1", options: { mask: [action] } };
    expect(StagehandMethods.pageScreenshot.params.parse(screenshot)).toEqual(screenshot);
  });

  it("represents a single selector without changing its value", () => {
    const chain = {
      steps: [{ type: "query", selector: { type: "text", value: 'text="Pay" >> now' } }],
    } satisfies LocatorChain;
    expect(LocatorChainSchema.parse(chain)).toEqual(chain);
  });

  it("preserves independent intermediate and final indices", () => {
    const chain = {
      steps: [
        { type: "query", selector: { type: "css", value: ".card" }, nth: 1 },
        { type: "query", selector: { type: "text", value: "Pay" }, nth: 0 },
      ],
    } satisfies LocatorChain;
    expect(LocatorChainSchema.parse(chain)).toEqual(chain);
  });

  it("distinguishes required frame entry from ordinary scoped queries", () => {
    const chain = {
      steps: [
        { type: "query", selector: { type: "css", value: "iframe.checkout" }, nth: 0 },
        { type: "frame", selector: { type: "xpath", value: "//iframe" }, nth: 1 },
        { type: "frame", selector: { type: "css", value: ".card" }, nth: 2 },
        { type: "query", selector: { type: "text", value: "Pay" } },
      ],
    } satisfies LocatorChain;
    expect(LocatorChainSchema.parse(chain)).toEqual(chain);
  });

  it.each([
    { steps: [] },
    { steps: [{ type: "query", selector: { type: "legacy", value: "iframe >> text=Pay" } }] },
    { steps: [{ type: "query", selector: { type: "css", value: ".card" }, nth: -1 }] },
    { steps: [{ type: "query", selector: { type: "css", value: ".card" }, nth: 0.5 }] },
  ])("rejects malformed query plans: %j", (chain) => {
    expect(LocatorChainSchema.safeParse(chain).success).toBe(false);
  });

  it("keeps non-empty chains and index constraints representable in JSON Schema", () => {
    const schema = z.toJSONSchema(LocatorChainSchema, { io: "input" });
    expect(schema.$defs?.LocatorChain.properties?.steps).toEqual({
      type: "array",
      items: { $ref: "#/$defs/LocatorStep" },
      minItems: 1,
    });
    expect(schema.$defs?.LocatorStep).toMatchObject({
      oneOf: [{ $ref: "#/$defs/LocatorQueryStep" }, { $ref: "#/$defs/LocatorFrameStep" }],
    });
    expect(schema.$defs?.LocatorQueryStep).toMatchObject({
      properties: { nth: { type: "integer", minimum: 0 } },
    });
    expect(schema.$defs).not.toHaveProperty("LegacyLocatorSelector");
  });
});
