import { afterEach, describe, expect, it, vi } from "vitest";
import * as client from "../services/decisions/client.js";
import { buildScalarReaderInput, mapCopyExtract } from "../services/decisions/mapCopy.js";

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

describe("selective scalar verification", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    { located: "Oak Lodge", vote: "no", confidence: 1, value: "Oak Lodge", direct: true, calls: 1 },
    {
      located: undefined,
      vote: "no",
      confidence: 0.97,
      value: "Oak Lodge",
      direct: false,
      calls: 2,
    },
    {
      located: undefined,
      vote: "no",
      confidence: 0.55,
      value: "Oak Lodge",
      direct: true,
      calls: 2,
    },
    { located: "Oak", vote: "span", confidence: 0.98, value: "Oak", direct: true, calls: 2 },
    { located: "Oak", vote: "full", confidence: 0.98, value: "Oak Lodge", direct: true, calls: 2 },
    { located: "Oak", vote: "span", confidence: 0.65, value: "Oak", direct: false, calls: 2 },
    { located: "Oak", vote: "none", confidence: 1, value: "Oak", direct: false, calls: 2 },
  ])(
    "handles $located with $vote at $confidence",
    async ({ located, vote, confidence, value, direct, calls }) => {
      const decide = vi
        .spyOn(client, "decide")
        .mockImplementation(async (_config, _state, questions) => {
          const verifying = "name" in questions;
          const key = verifying ? "name" : "f_name";
          const choice = verifying ? vote : "t0";
          const score = verifying ? confidence : 1;
          return {
            model: "test",
            answers: {
              [key]: {
                type: "choice",
                choice,
                probabilities: { [choice]: score },
                confidence: score,
              },
            },
            usage: { inputTokens: 1, outputTokens: 1 },
            durationMs: 1,
          };
        });
      const result = await mapCopyExtract(
        { apiKey: "test" },
        {
          schema: { type: "object", required: ["name"], properties: { name: { type: "string" } } },
          instruction: "Read the name.",
          tree: "[0-1] heading: Oak Lodge",
          urlMap: {},
          reader: async () => ({ name: located }),
        },
      );
      expect(result.data.name).toBe(value);
      expect(result.verdict.problems).toEqual(direct ? [] : ["unverified:name"]);
      expect(decide).toHaveBeenCalledTimes(calls);
    },
  );
});
