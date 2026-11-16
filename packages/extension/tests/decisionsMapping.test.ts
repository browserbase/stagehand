import { afterEach, describe, expect, it, vi } from "vitest";
import * as client from "../services/decisions/client.js";
import { mapCopyExtract } from "../services/decisions/mapCopy.js";

afterEach(() => vi.restoreAllMocks());

describe("Decisions missing values", () => {
  it("omits absent optional scalars and returns null for absent nullable scalars", async () => {
    vi.spyOn(client, "decide").mockImplementation(async (_config, _state, questions) => ({
      model: "test",
      answers: Object.fromEntries(
        Object.entries(questions).map(([key, question]) => [
          key,
          question.type === "choice"
            ? { type: "choice" as const, choice: "none", probabilities: { none: 1 }, confidence: 1 }
            : { type: "noul" as const, noul: 1 },
        ]),
      ),
      usage: { inputTokens: 1, outputTokens: 1 },
      durationMs: 1,
    }));
    const outcome = await mapCopyExtract(
      { apiKey: "test" },
      {
        instruction: "Extract issue and star counts when present.",
        schema: {
          type: "object",
          properties: { issues: { type: "number" }, stars: { type: ["number", "null"] } },
          required: ["stars"],
        },
        tree: "[0-1] heading: Example",
        urlMap: {},
      },
    );
    expect(outcome.data).toEqual({ stars: null });
    expect(outcome.verdict?.problems).toEqual([]);
  });

  it("rejects a required unresolved scalar instead of inventing an empty string", async () => {
    await expect(
      mapCopyExtract(
        { apiKey: "test" },
        {
          instruction: "Extract name.",
          schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
          tree: "",
          urlMap: {},
        },
      ),
    ).rejects.toThrow("unresolved:name");
  });
});

describe("Decisions composite labels", () => {
  it.each([true, false])(
    "offers the identifier as a span alongside the whole value (%s)",
    async (copyName) => {
      vi.spyOn(client, "decide").mockImplementation(async (_config, _state, questions) => ({
        model: "test",
        answers: Object.fromEntries(
          Object.entries(questions).map(([key, question]) => {
            if (question.type === "noul")
              return [key, { type: "noul" as const, noul: key.startsWith("is_") ? 1 : 0 }];
            if (question.type !== "choice") throw new Error("Expected a choice");
            const choices = Object.entries(question.type === "choice" ? question.criteria : {});
            const span = choices.find(
              ([, label]) =>
                typeof label === "string" &&
                label.startsWith("Identifier before the opening parenthesis"),
            );
            if (key === "f_items") expect(span?.[1]).toContain('"publish"');
            const choice = (copyName ? span?.[0] : undefined) ?? choices[0]![0];
            return [
              key,
              { type: "choice" as const, choice, probabilities: { [choice]: 1 }, confidence: 1 },
            ];
          }),
        ),
        usage: { inputTokens: 1, outputTokens: 1 },
        durationMs: 1,
      }));
      const result = await mapCopyExtract(
        { apiKey: "test" },
        {
          instruction: copyName ? "Copy the function names." : "Copy the signatures.",
          schema: {
            type: "object",
            required: ["items"],
            properties: { items: { type: "array", items: { type: "string" } } },
          },
          tree: "[1] list\n  [2] listitem: publish(message)\n  [3] listitem: read()\n  [4] listitem: close()",
          urlMap: {},
        },
      );
      expect(result.data).toEqual({
        items: copyName ? ["publish", "read", "close"] : ["publish(message)", "read()", "close()"],
      });
    },
  );

  it("keeps an unspaced colon in a copied list value", async () => {
    vi.spyOn(client, "decide").mockImplementation(async (_config, _state, questions) => ({
      model: "test",
      answers: Object.fromEntries(
        Object.entries(questions).map(([key, question]) => {
          if (question.type === "noul")
            return [key, { type: "noul" as const, noul: key.startsWith("is_") ? 1 : 0 }];
          if (question.type !== "choice") throw new Error("Expected a choice");
          const choice = Object.keys(question.type === "choice" ? question.criteria : {})[0]!;
          return [
            key,
            { type: "choice" as const, choice, probabilities: { [choice]: 1 }, confidence: 1 },
          ];
        }),
      ),
      usage: { inputTokens: 1, outputTokens: 1 },
      durationMs: 1,
    }));
    const result = await mapCopyExtract(
      { apiKey: "test" },
      {
        instruction: "Copy all identifiers.",
        schema: {
          type: "object",
          required: ["items"],
          properties: { items: { type: "array", items: { type: "string" } } },
        },
        tree: "[1] list\n  [2] listitem: kind:alpha\n  [3] listitem: kind:beta\n  [4] listitem: ID: gamma",
        urlMap: {},
      },
    );
    expect(result.data).toEqual({ items: ["kind:alpha", "kind:beta", "ID: gamma"] });
  });

  it("can copy the title without a dotted section number in a scalar list", async () => {
    vi.spyOn(client, "decide").mockImplementation(async (_config, _state, questions) => ({
      model: "test",
      answers: Object.fromEntries(
        Object.entries(questions).map(([key, question]) => {
          if (question.type === "noul")
            return [key, { type: "noul" as const, noul: key.startsWith("is_") ? 1 : 0 }];
          const options = Object.entries(question.type === "choice" ? question.criteria : {});
          const choice =
            options.find(
              ([, label]) =>
                typeof label === "string" &&
                label.startsWith("Text after the leading numeric identifier"),
            )?.[0] ?? options[0]![0];
          return [
            key,
            { type: "choice" as const, choice, probabilities: { [choice]: 1 }, confidence: 1 },
          ];
        }),
      ),
      usage: { inputTokens: 1, outputTokens: 1 },
      durationMs: 1,
    }));
    const result = await mapCopyExtract(
      { apiKey: "test" },
      {
        instruction: "Extract the titles. Omit section numbers.",
        schema: {
          type: "object",
          required: ["titles"],
          properties: { titles: { type: "array", items: { type: "string" } } },
        },
        tree: "[1] DescriptionList\n  [2] term: 2.1. Introduction\n  [3] term: 2.2. Setup\n  [4] term: 2.3. Examples",
        urlMap: {},
      },
    );
    expect(result.data).toEqual({ titles: ["Introduction", "Setup", "Examples"] });
  });

  it.each([true, false])(
    "lets the model select the name separately from the code (%s)",
    async (stripPrefix) => {
      vi.spyOn(client, "decide").mockImplementation(async (_config, _state, questions) => ({
        model: "test",
        answers: Object.fromEntries(
          Object.entries(questions).map(([key, question]) => {
            if (question.type === "noul")
              return [key, { type: "noul" as const, noul: key.startsWith("is_") ? 1 : 0 }];
            let choice = Object.keys(question.type === "choice" ? question.criteria : {})[0]!;
            if (key === "f_name" && stripPrefix) {
              choice = Object.entries(question.type === "choice" ? question.criteria : {}).find(
                ([, label]) =>
                  typeof label === "string" &&
                  label.startsWith("Text after the leading numeric identifier"),
              )![0];
            }
            return [
              key,
              { type: "choice" as const, choice, probabilities: { [choice]: 1 }, confidence: 1 },
            ];
          }),
        ),
        usage: { inputTokens: 1, outputTokens: 1 },
        durationMs: 1,
      }));
      const outcome = await mapCopyExtract(
        { apiKey: "test" },
        {
          instruction: "Extract every code and name.",
          schema: {
            type: "object",
            required: ["items"],
            properties: {
              items: {
                type: "array",
                items: {
                  type: "object",
                  required: ["code", "name"],
                  properties: { code: { type: "integer" }, name: { type: "string" } },
                },
              },
            },
          },
          tree: "[0-1] list\n  [0-2] listitem: 101 Bronze\n  [0-3] listitem: 102 Silver\n  [0-4] listitem: 103 Gold",
          urlMap: {},
        },
      );
      expect(outcome.data.items).toEqual([
        { code: 101, name: stripPrefix ? "Bronze" : "101 Bronze" },
        { code: 102, name: stripPrefix ? "Silver" : "102 Silver" },
        { code: 103, name: stripPrefix ? "Gold" : "103 Gold" },
      ]);
    },
  );
});

it("omits an optional number when its candidate does not explicitly state the field", async () => {
  vi.spyOn(client, "decide").mockImplementation(async (_config, _state, questions) => ({
    model: "test",
    answers: Object.fromEntries(
      Object.entries(questions).map(([key, question]) => {
        if (question.type === "noul") return [key, { type: "noul", noul: 0 }];
        const choice =
          key === "record_group"
            ? "none"
            : Object.keys(question.type === "choice" ? question.criteria : {})[0]!;
        return [key, { type: "choice", choice, probabilities: { [choice]: 1 }, confidence: 1 }];
      }),
    ),
    usage: { inputTokens: 1, outputTokens: 1 },
    durationMs: 1,
  }));
  const result = await mapCopyExtract(
    { apiKey: "test" },
    {
      instruction: "Extract the product title and its edition if explicitly stated.",
      schema: {
        type: "object",
        required: ["title"],
        properties: { title: { type: "string" }, edition: { type: "number" } },
      },
      tree: "[0-1] heading: Example Product 2.0",
      urlMap: {},
      reader: async () => ({ edition: "2.0" }),
    },
  );
  expect(result.data).toEqual({ title: "Example Product 2.0" });
});

it("skips field mapping when the group check rejects a standalone list", async () => {
  const decide = vi.spyOn(client, "decide").mockResolvedValue({
    model: "test",
    answers: {
      group: { type: "choice", choice: "g0", probabilities: { g0: 1 }, confidence: 1 },
      is_g0: { type: "noul", noul: 0.1 },
    },
    usage: { inputTokens: 1, outputTokens: 1 },
    durationMs: 1,
  });
  await expect(
    mapCopyExtract(
      { apiKey: "test" },
      {
        instruction: "Extract every item.",
        schema: {
          type: "object",
          required: ["items"],
          properties: { items: { type: "array", items: { type: "string" } } },
        },
        tree: "[0-1] list\n  [0-2] listitem: Bronze\n  [0-3] listitem: Silver\n  [0-4] listitem: Gold",
        urlMap: {},
      },
    ),
  ).rejects.toThrow("group-disagree:items");
  expect(decide).toHaveBeenCalledTimes(1);
});
