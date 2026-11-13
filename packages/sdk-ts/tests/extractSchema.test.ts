import { describe, expect, it } from "vitest";
import { z } from "zod/v4";
import { elementRef } from "../src/index.js";

describe("elementRef()", () => {
  it("marks a string field as an extract element in JSON Schema", () => {
    expect(z.toJSONSchema(elementRef())).toMatchObject({
      type: "string",
      "x-stagehand": "element",
    });
  });

  it("keeps the marker alongside descriptions and wrappers", () => {
    const schema = z.object({
      described: elementRef("The row that holds the account number"),
      chained: elementRef().describe("The submit button"),
      optional: elementRef().optional(),
      list: z.array(elementRef()).nullable(),
    });

    expect(z.toJSONSchema(schema)).toMatchObject({
      properties: {
        described: {
          type: "string",
          "x-stagehand": "element",
          description: "The row that holds the account number",
        },
        chained: {
          type: "string",
          "x-stagehand": "element",
          description: "The submit button",
        },
        optional: { type: "string", "x-stagehand": "element" },
        list: {
          anyOf: [{ type: "array", items: { type: "string", "x-stagehand": "element" } }, {}],
        },
      },
      required: ["described", "chained", "list"],
    });
  });

  it("parses the selector strings that extract() returns", () => {
    expect(elementRef().parse("xpath=/html/body/button")).toBe("xpath=/html/body/button");
    expect(elementRef().parse("")).toBe("");
  });
});
