import { describe, expect, it } from "vitest";
import { buildScalarReaderInput } from "../services/decisions/mapCopy.js";

describe("bounded scalar evidence", () => {
  it("keeps values later in a paragraph available to the independent reader", () => {
    const prefix = "Background information about this measurement. ".repeat(10);
    const input = buildScalarReaderInput(
      { type: "object", properties: { reading: { type: "number" } }, required: ["reading"] },
      `[0-1] RootWebArea: Measurements\n  [0-2] paragraph\n    [0-3] StaticText: ${prefix}The exact reading is 42.125 units.`,
      {},
      "Extract the exact reading.",
    );
    expect(input.sheet).toContain("42.125");
    expect(input.sheet).toContain("The exact reading is");
  });
});
