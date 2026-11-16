import { afterEach, describe, expect, it, vi } from "vitest";
import * as client from "../services/decisions/client.js";
import { buildDataView, readSlot } from "../services/decisions/dataView.js";
import { mapCopyExtract } from "../services/decisions/mapCopy.js";
import type { JsonSchema } from "../services/decisions/extractionSchema.js";
import { parseNumber } from "../services/decisions/extractionShared.js";

afterEach(() => vi.restoreAllMocks());

const listSchema: JsonSchema = {
  type: "object",
  required: ["items"],
  properties: { items: { type: "array", items: { type: "string" } } },
};

function scriptDecisions(
  override: (key: string, question: client.DecisionQuestion) => string | number | undefined = () =>
    undefined,
) {
  return vi.spyOn(client, "decide").mockImplementation(async (_config, _state, questions) => ({
    model: "test",
    answers: Object.fromEntries(
      Object.entries(questions).map(([key, question]) => {
        const answer = override(key, question);
        if (question.type === "noul")
          return [key, { type: "noul", noul: answer ?? (key.startsWith("is_") ? 1 : 0) }];
        if (question.type !== "choice") throw new Error("Unexpected reader request");
        const choice = answer ?? Object.keys(question.criteria)[0]!;
        return [key, { type: "choice", choice, probabilities: { [choice]: 1 }, confidence: 1 }];
      }),
    ),
    usage: { inputTokens: 1, outputTokens: 1 },
    durationMs: 1,
  }));
}

describe("extraction acceptance", () => {
  it("keeps rejected rows out of a fixed-count result when too few qualify", async () => {
    scriptDecisions((key) =>
      /^r\d+$/.test(key) ? (Number(key.slice(1)) >= 4 ? 1 : 0) : undefined,
    );
    const result = await mapCopyExtract(
      { apiKey: "test" },
      {
        instruction: "Extract the first 3 modes.",
        schema: listSchema,
        tree:
          "[1] list\n" +
          Array.from({ length: 6 }, (_, i) => `  [${i + 2}] listitem: Mode ${i + 1}`).join("\n"),
        urlMap: {},
      },
    );
    expect(result.data.items).toEqual(["Mode 5", "Mode 6"]);
    expect(result.verdict.problems).toContain("count-short:items:2/3");
  });

  it("checks row constraints after narrowing a list to selected sections", async () => {
    let group: string | undefined;
    const decide = scriptDecisions((key, question) => {
      if (key === "group" && question.type === "choice") {
        group = Object.entries(question.criteria).find(
          ([, value]) => typeof value === "string" && value.startsWith("6 items"),
        )?.[0];
        return group;
      }
      if (key.startsWith("is_")) return key === `is_${group}` ? 1 : 0;
      if (key === "subset" || key === "sec0") return 1;
      if (key === "sec1") return 0;
      if (/^r\d+$/.test(key)) return key === "r1" ? 0 : 1;
      return undefined;
    });
    const result = await mapCopyExtract(
      { apiKey: "test" },
      {
        instruction: "Extract the active modes from Current.",
        schema: listSchema,
        tree: `[1] document
  [2] section
    [3] heading: Current
    [4] list
      [5] listitem: Active Alpha
        [15] StaticText: Active Alpha
      [6] listitem: Retired Beta
        [16] StaticText: Retired Beta
      [7] listitem: Active Gamma
        [17] StaticText: Active Gamma
  [8] section
    [9] heading: Archive
    [10] list
      [11] listitem: Active Delta
        [18] StaticText: Active Delta
      [12] listitem: Retired Epsilon
        [19] StaticText: Retired Epsilon
      [13] listitem: Active Zeta
        [20] StaticText: Active Zeta`,
        urlMap: {},
      },
    );
    expect(result.data.items).toEqual(["Active Alpha", "Active Gamma"]);
    expect(decide.mock.calls.some(([, , questions]) => "sec0" in questions)).toBe(true);
    expect(decide.mock.calls.some(([, , questions]) => "r1" in questions)).toBe(true);
  });

  it("accepts omission of an unresolved optional list", async () => {
    const result = await mapCopyExtract(
      { apiKey: "test" },
      {
        instruction: "Extract modes if present.",
        schema: { ...listSchema, required: [] },
        tree: "",
        urlMap: {},
      },
    );
    expect(result.data).toEqual({});
    expect(result.verdict.problems).toEqual([]);
  });

  it("does not substitute a record's name for a missing mapped child", () => {
    const view = buildDataView(
      "[1] list\n  [2] listitem: Alpha\n    [3] link: More\n  [4] listitem: Beta",
      {},
    );
    expect(readSlot(view, view.nodes[1]!, "link[1]")?.name).toBe("More");
    expect(readSlot(view, view.nodes[3]!, "link[1]")).toBeUndefined();
  });

  it.each(["scalar", "list"] as const)("preserves a colon inside a %s title", async (kind) => {
    scriptDecisions((key) => (key === "record_group" ? "none" : undefined));
    const result = await mapCopyExtract(
      { apiKey: "test" },
      {
        instruction: "Copy the title exactly.",
        schema:
          kind === "scalar"
            ? { type: "object", properties: { title: { type: "string" } }, required: ["title"] }
            : {
                type: "object",
                properties: { titles: { type: "array", items: { type: "string" } } },
                required: ["titles"],
              },
        tree:
          kind === "scalar"
            ? "[1] heading: Star Trek: Discovery"
            : "[1] list\n  [2] listitem: Star Trek: Discovery\n  [3] listitem: Star Trek: Voyager\n  [4] listitem: Star Trek: Picard",
        urlMap: {},
      },
    );
    expect(result.data).toEqual(
      kind === "scalar"
        ? { title: "Star Trek: Discovery" }
        : { titles: ["Star Trek: Discovery", "Star Trek: Voyager", "Star Trek: Picard"] },
    );
    expect(result.verdict.problems).toEqual([]);
  });

  it("strips an explicit field label when it matches the requested field", async () => {
    scriptDecisions();
    const result = await mapCopyExtract(
      { apiKey: "test" },
      {
        instruction: "Extract the title.",
        schema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] },
        tree: "[1] StaticText: Title: Example",
        urlMap: {},
      },
    );
    expect(result.data).toEqual({ title: "Example" });
  });

  it.each([
    [".5", 0.5],
    ["-.5", -0.5],
    ["1e-3", 0.001],
    ["-$1,234.50", -1234.5],
    ["3.5 million", 3500000],
  ] as const)("reads a complete numeric literal %s", (text, expected) => {
    expect(parseNumber(text, new Set())).toBe(expected);
  });

  it("does not certify a numeric reader span taken from inside another number", async () => {
    scriptDecisions(() => "none");
    await expect(
      mapCopyExtract(
        { apiKey: "test" },
        {
          instruction: "Extract the count.",
          schema: {
            type: "object",
            properties: { count: { type: "number" } },
            required: ["count"],
          },
          tree: "[1] StaticText: Count: 10",
          urlMap: {},
          reader: async () => ({ count: "0" }),
        },
      ),
    ).rejects.toThrow("unresolved:count");
  });

  it("rejects a missing numeric position instead of copying a different number", async () => {
    scriptDecisions((key) => (key === "n_year" ? "p1" : undefined));
    const result = await mapCopyExtract(
      { apiKey: "test" },
      {
        instruction: "Extract every publication year.",
        schema: {
          type: "object",
          required: ["items"],
          properties: {
            items: {
              type: "array",
              items: {
                type: "object",
                required: ["year"],
                properties: { year: { type: "integer" } },
              },
            },
          },
        },
        tree: "[1] list\n  [2] listitem: Volume 10 (2024)\n  [3] listitem: Volume 11 (2025)\n  [4] listitem: Volume 12",
        urlMap: {},
      },
    );
    expect(result.data.items).toEqual([{ year: 2024 }, { year: 2025 }, {}]);
    expect(result.verdict.problems).toContain("missing:items.year:1/3");
  });

  it.each([
    { inherit: false, newSection: false },
    { inherit: true, newSection: false },
    { inherit: true, newSection: true },
  ])(
    "inherits sparse values only within their shared scope: %j",
    async ({ inherit, newSection }) => {
      scriptDecisions((key, question) => {
        if (key === "inherit_rating") return inherit ? 1 : 0;
        if (key === "f_name" && question.type === "choice")
          return Object.entries(question.criteria).find(
            ([, value]) => typeof value === "string" && value.includes('"Alpha"'),
          )?.[0];
        if (key === "f_rating" && question.type === "choice")
          return Object.entries(question.criteria).find(
            ([, value]) => typeof value === "string" && value.includes('"7"'),
          )?.[0];
        return undefined;
      });
      const result = await mapCopyExtract(
        { apiKey: "test" },
        {
          instruction: "Extract each product name and its rating if present.",
          schema: {
            type: "object",
            required: ["items"],
            properties: {
              items: {
                type: "array",
                items: {
                  type: "object",
                  required: ["name"],
                  properties: {
                    name: { type: "string" },
                    rating: { type: "number" },
                  },
                },
              },
            },
          },
          tree: `[1] document
  [2] heading: Current
  [3] list
    [4] listitem
      [5] link: Alpha
      [6] strong: 7
    [7] listitem
      [8] link: Beta
${newSection ? "    [11] heading: Archive\n" : ""}    [9] listitem
      [10] link: Gamma`,
          urlMap: {},
        },
      );
      expect(result.data.items).toEqual([
        { name: "Alpha", rating: 7 },
        { name: "Beta", ...(inherit ? { rating: 7 } : {}) },
        { name: "Gamma", ...(inherit && !newSection ? { rating: 7 } : {}) },
      ]);
    },
  );

  it("waits for independent scalar reading before rejecting failed mapping", async () => {
    let release!: () => void;
    const reading = new Promise<Record<string, string>>((resolve) => {
      release = () => resolve({ name: "Example" });
    });
    vi.spyOn(client, "decide").mockRejectedValue(new Error("failed mapping"));
    let settled = false;
    const pending = mapCopyExtract(
      { apiKey: "test" },
      {
        instruction: "Extract the name.",
        schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
        tree: "[1] heading: Example",
        urlMap: {},
        reader: () => reading,
      },
    ).finally(() => {
      settled = true;
    });
    const rejected = expect(pending).rejects.toThrow("failed mapping");
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const settledBeforeReading = settled;
    release();
    await rejected;
    expect(settledBeforeReading).toBe(false);
  });
});
