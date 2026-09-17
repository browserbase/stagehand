import { trace } from "@opentelemetry/api";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StagehandLogger } from "../logger.js";
import {
  compactForJudge,
  findGroups,
  parseNumberText,
  planSchema,
  runJevExtract,
  type JevExtractDeps,
  type JsonSchema,
} from "../services/jevAct/extract.js";
import { parseOutline } from "../services/jevAct/tree.js";

const PAGE = [
  "[0-1] RootWebArea: Acme store",
  "  [0-2] heading: Blue Kettle",
  "  [0-3] paragraph",
  "    [0-4] StaticText: Price:",
  "    [0-5] StaticText: $1,249.50",
  "  [0-6] link: Read the manual",
  "  [0-7] list",
  "    [0-8] listitem",
  "      [0-9] link: Alice Doe",
  "      [0-10] StaticText: 5 stars",
  "    [0-11] listitem",
  "      [0-12] link: Bob Roe",
  "      [0-13] StaticText: 3 stars",
  "    [0-14] listitem",
  "      [0-15] link: Cy Poe",
  "      [0-16] StaticText: 4 stars",
].join("\n");

function deps(schema: JsonSchema, overrides: Partial<JevExtractDeps> = {}): JevExtractDeps {
  return {
    logger: new StagehandLogger({ tracer: trace.getTracer("jev-extract-test") }, () => {}),
    instruction: "extract the product and its reviews",
    schema,
    snap: { tree: PAGE, xpathMap: {}, nodes: parseOutline(PAGE) },
    urlMap: { "0-6": "https://acme.test/manual.pdf", "0-9": "https://acme.test/u/alice" },
    ensureTimeRemaining: () => {},
    gate: true,
    ...overrides,
  };
}

/** Answers every pick by looking at which field the request is about. */
function stubByField(picks: Record<string, string>, completed = 0.9) {
  const bodies: Array<{ state: { instruction?: string } }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      bodies.push(body);
      const field = /Field to find: ([\w.]+)/.exec(body.state.instruction ?? "")?.[1] ?? "";
      const answers = Object.fromEntries(
        Object.entries(body.questions as Record<string, { type: string; criteria?: object }>).map(
          ([key, question]) => {
            if (key === "completed") return [key, { type: "noul", noul: completed }];
            if (question.type === "noul") return [key, { type: "noul", noul: 0.95 }];
            const options = Object.entries((question.criteria ?? {}) as Record<string, unknown>);
            const group = options.find(
              ([id, value]) => id.startsWith("group_") && JSON.stringify(value).includes("Alice"),
            );
            // "no_group": best still names the group (it has no none option),
            // strict vetoes it with the real none-of-these id.
            const choice =
              picks[field] === "no_group"
                ? key === "strict"
                  ? "none_match"
                  : (group?.[0] ?? "none_match")
                : group
                  ? group[0]
                  : (picks[field] ?? "none_match");
            return [
              key,
              { type: "choice", choice, confidence: 0.95, probabilities: { [choice]: 0.95 } },
            ];
          },
        ),
      );
      return new Response(
        JSON.stringify({ model: "jev", answers, usage: { input_tokens: 1, output_tokens: 1 } }),
      );
    }),
  );
  return bodies;
}

afterEach(() => vi.unstubAllGlobals());

describe("jev extract (pick-and-copy)", () => {
  it("copies scalars from the picked elements: text, parsed number, link URL", async () => {
    stubByField({ name: "0-2", price: "0-3", manual: "0-6" });
    const outcome = await runJevExtract(
      { apiKey: "test" },
      deps({
        type: "object",
        required: ["name", "price", "manual"],
        properties: {
          name: { type: "string" },
          price: { type: "number", description: "price in dollars" },
          manual: { type: "string", format: "uri" },
        },
      }),
    );

    expect(outcome).toEqual({
      kind: "done",
      completed: true,
      data: { name: "Blue Kettle", price: 1249.5, manual: "https://acme.test/manual.pdf" },
    });
  });

  it("induces a list from the first item and reads the same position in every sibling", async () => {
    stubByField({ author: "0-9", rating: "0-10" });
    const outcome = await runJevExtract(
      { apiKey: "test" },
      deps({
        type: "object",
        required: ["reviews"],
        properties: {
          reviews: {
            type: "array",
            items: {
              type: "object",
              required: ["author", "rating"],
              properties: { author: { type: "string" }, rating: { type: "integer" } },
            },
          },
        },
      }),
    );

    expect(outcome).toMatchObject({
      kind: "done",
      data: {
        reviews: [
          { author: "Alice Doe", rating: 5 },
          { author: "Bob Roe", rating: 3 },
          { author: "Cy Poe", rating: 4 },
        ],
      },
    });
  });

  it("honours 'top N' and hands off when a required field cannot be found or the gate says incomplete", async () => {
    const schema: JsonSchema = {
      type: "object",
      required: ["authors"],
      properties: { authors: { type: "array", items: { type: "string" } } },
    };
    stubByField({ value: "0-9" });
    expect(
      await runJevExtract(
        { apiKey: "test" },
        deps(schema, { instruction: "extract the top 2 review authors" }),
      ),
    ).toMatchObject({ kind: "done", data: { authors: ["Alice Doe", "Bob Roe"] } });

    stubByField({ authors: "no_group" });
    expect(await runJevExtract({ apiKey: "test" }, deps(schema))).toMatchObject({
      kind: "fallback",
      reason: "unresolved:authors",
    });

    stubByField({ value: "0-9" }, 0.1);
    expect(await runJevExtract({ apiKey: "test" }, deps(schema))).toMatchObject({
      kind: "fallback",
      reason: expect.stringContaining("incomplete"),
    });
  });

  it("reads oddly shaped items leniently, but never a header's text as a value", async () => {
    const page = [
      "[0-1] table: Parts",
      "  [0-2] row",
      "    [0-3] cell: Economy",
      "  [0-4] row",
      "    [0-5] cell: FVP",
      "    [0-6] cell: GREEN5050GAL",
      "  [0-7] row",
      "    [0-8] cell: PEAK",
      "    [0-9] cell: AF3300",
      "  [0-10] row",
      "    [0-11] cell: ZEREX",
      "    [0-12] cell: 719009",
      "    [0-13] cell: NEW",
    ].join("\n");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string);
        const answers = Object.fromEntries(
          Object.entries(
            body.questions as Record<string, { type: string; criteria?: Record<string, unknown> }>,
          ).map(([key, question]) => {
            if (question.type === "noul") {
              return [
                key,
                {
                  type: "noul",
                  noul: /"(name|text)":"Economy"/.test(JSON.stringify(question)) ? 0.05 : 0.9,
                },
              ];
            }
            const options = Object.entries(question.criteria ?? {});
            const pick =
              options.find(
                ([id, value]) => id.startsWith("group_") && JSON.stringify(value).includes('"row"'),
              )?.[0] ??
              options.find(([, value]) => JSON.stringify(value).includes("GREEN5050GAL"))?.[0] ??
              "none_match";
            return [
              key,
              { type: "choice", choice: pick, confidence: 0.95, probabilities: { [pick]: 0.95 } },
            ];
          }),
        );
        return new Response(
          JSON.stringify({ model: "jev", answers, usage: { input_tokens: 1, output_tokens: 1 } }),
        );
      }),
    );
    const outcome = await runJevExtract(
      { apiKey: "test" },
      deps(
        {
          type: "object",
          required: ["parts"],
          properties: {
            parts: {
              type: "array",
              items: {
                type: "object",
                required: ["part_number"],
                properties: { part_number: { type: "string" } },
              },
            },
          },
        },
        {
          instruction: "extract the part numbers",
          snap: { tree: page, xpathMap: {}, nodes: parseOutline(page) },
          urlMap: {},
        },
      ),
    );
    // "Economy" (header row) is dropped; the 3-cell row still yields its part number.
    expect(outcome).toMatchObject({
      kind: "done",
      data: {
        parts: [
          { part_number: "GREEN5050GAL" },
          { part_number: "AF3300" },
          { part_number: "719009" },
        ],
      },
    });
  });

  it("finds sibling groups and flat heading-led runs", () => {
    const flat = parseOutline(
      [
        "[0-1] main",
        "  [0-2] heading: First report",
        "  [0-3] StaticText: December 9, 2024",
        "  [0-4] paragraph: Summary one",
        "  [0-5] heading: Second report",
        "  [0-6] StaticText: November 2, 2024",
        "  [0-7] paragraph: Summary two",
        "  [0-8] heading: Third report",
        "  [0-9] StaticText: October 1, 2024",
        "  [0-10] paragraph: Summary three",
      ].join("\n"),
    );
    const run = findGroups(flat).find((group) => group.kind === "flat" && group.role === "heading");
    expect(run?.items.map((item) => item.map((node) => node.id))).toEqual([
      ["0-2", "0-3", "0-4"],
      ["0-5", "0-6", "0-7"],
      ["0-8", "0-9", "0-10"],
    ]);
    expect(
      findGroups(parseOutline(PAGE)).some(
        (group) => group.role === "listitem" && group.items.length === 3,
      ),
    ).toBe(true);
  });

  it("refuses schemas it cannot copy into", () => {
    expect(() => planSchema({ type: "string" })).toThrow("root_not_object");
    expect(() =>
      planSchema({
        type: "object",
        properties: {
          rows: {
            type: "array",
            items: {
              type: "object",
              properties: { cells: { type: "array", items: { type: "string" } } },
            },
          },
        },
      }),
    ).toThrow("nested_array");
    expect(
      planSchema({
        type: "object",
        properties: { note: { anyOf: [{ type: "string" }, { type: "null" }] } },
      }).leaves[0],
    ).toMatchObject({ kind: "string", required: false });
  });
});

describe("extract helpers", () => {
  it("keeps the k/M scale when a unit word follows and ignores a spaced letter", () => {
    expect(parseNumberText("1.2k stars")).toBe(1200);
    expect(parseNumberText("3M views")).toBe(3_000_000);
    expect(parseNumberText("$1,249.50")).toBe(1249.5);
    expect(parseNumberText("2 km")).toBe(2);
    expect(parseNumberText("no digits")).toBeUndefined();
  });

  it("shows the judge a compact view of a large list instead of failing it", () => {
    const items = Array.from({ length: 80 }, (_, i) => ({
      title: `Item ${i}`.padEnd(90, "x"),
      url: `https://e.com/${i}`,
    }));
    const compact = compactForJudge({ items }) as {
      items: { item_count: number; first_items: unknown[] };
    };
    expect(compact.items.item_count).toBe(80);
    expect(compact.items.first_items).toHaveLength(3);
    expect(JSON.stringify(compact).length).toBeLessThan(6000);
    // Small results pass through untouched.
    expect(compactForJudge({ a: 1 })).toEqual({ a: 1 });
  });
});
