import { describe, expect, it } from "vitest";
import {
  requestedHeadings,
  snapshotHeadingNames,
} from "../services/decisions/headingProjection.js";
import type { JsonSchema } from "../services/decisions/extractionSchema.js";
import type { HybridSnapshot } from "../types/private/snapshot.js";

const schema: JsonSchema = {
  type: "object",
  required: ["headings"],
  properties: { headings: { type: "array", items: { type: "string" } } },
};

const prompt = "List all H2 headings on this page.";
const paths = { "0-3": "/html/body/h2[1]", "0-4": "/html/body/h3[1]", "0-5": "/html/body/h2[2]" };
const outline = "[0-3] heading: Repeat\n[0-4] heading: Detail\n[0-5] heading: Repeat";
const snapshot: HybridSnapshot = {
  combinedTree: outline,
  combinedXpathMap: paths,
  combinedUrlMap: {},
  perFrame: [{ frameId: "main", outline, xpathMap: paths, urlMap: {} }],
};

describe("bounded heading projection", () => {
  it("requires an exhaustive request with one explicit level and output field", () => {
    expect(requestedHeadings(prompt, schema)).toEqual({
      level: 2,
      field: "headings",
      sections: false,
    });
    expect(
      requestedHeadings(
        "Copy every level-two section heading in order. Return the result in titles.",
        {
          ...schema,
          required: ["titles"],
          properties: { titles: schema.properties!.headings! },
        },
      ),
    ).toEqual({ level: 2, field: "titles", sections: true });
    for (const task of [
      "List the headings.",
      "Return all H2 and H3 headings.",
      "List all H2 headings starting with A.",
      "List all h2 headings on every page.",
      "List all level 2 links.",
      "List the first three H2 headings.",
      "List all h2 headings in the footer.",
      "List all h2 headings alphabetically.",
      "List all h2 headings. Return the result in other.",
    ])
      expect(requestedHeadings(task, schema)).toBeUndefined();
  });

  it("declines schema guidance the projection cannot enforce", () => {
    for (const unsupported of [
      { ...schema, required: [] },
      { ...schema, properties: { ...schema.properties, author: { type: "string" } } },
      { ...schema, description: "Translate all text to Spanish" },
      {
        ...schema,
        properties: {
          headings: {
            type: "array",
            description: "Only uppercase headings",
            items: { type: "string" },
          },
        },
      },
      {
        ...schema,
        properties: { headings: { type: "array", items: { type: "string", format: "uri" } } },
      },
      {
        ...schema,
        properties: { headings: { type: "array", maxItems: 2, items: { type: "string" } } },
      },
    ])
      expect(requestedHeadings(prompt, unsupported as JsonSchema)).toBeUndefined();
  });

  it("preserves repeats and level, and rejects missing or ambiguous structural evidence", () => {
    expect(snapshotHeadingNames(snapshot, 2)).toEqual(["Repeat", "Repeat"]);
    expect(snapshotHeadingNames(snapshot, 6)).toBeUndefined();
    for (const changed of [
      { combinedTree: outline.split("\n")[0]! },
      { combinedTree: outline.replace("0-5", "0-3") },
      { combinedXpathMap: { ...paths, "0-5": "/html/body/div[1]" } },
      { combinedXpathMap: { ...paths, "0-8": "/html/body/iframe[1]" } },
      { combinedXpathMap: { ...paths, "0-8": "/html/body/x-host[1]//h2[1]" } },
      { perFrame: undefined },
      { perFrame: [...snapshot.perFrame!, ...snapshot.perFrame!] },
    ])
      expect(snapshotHeadingNames({ ...snapshot, ...changed }, 2)).toBeUndefined();
  });
});
