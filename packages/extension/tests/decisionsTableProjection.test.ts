import { describe, expect, it, vi } from "vitest";
import { trace } from "@opentelemetry/api";
import { extract } from "../services/extractService.js";
import { StagehandLogger } from "../logger.js";
import { tableContext } from "../services/decisions/tableEvidence.js";
import { projectTable, tableRequest } from "../services/decisions/tableProjection.js";

const task = "Copy Code and Label for every row of the table.";
const request = tableRequest(task, {
  type: "object",
  required: ["rows"],
  properties: {
    rows: {
      type: "array",
      items: {
        type: "object",
        required: ["label", "code"],
        properties: {
          label: { type: "string" },
          code: { type: "string" },
        },
      },
    },
  },
})!;
const evidence: Parameters<typeof projectTable>[3] = {
  headers: ["Code", "Label"],
  title: "Catalog",
  groups: [],
  tableSizes: [2],
  positions: [[0, 1]],
  markers: [[0, 0, ["Code", "Label"]]],
  rows: [
    [
      { text: "C11", beforeLink: "C11" },
      { text: "Subpart (c)(ii)\nReference", beforeLink: "Subpart (c)(ii)" },
    ],
  ],
};
const table = "/html[1]/body[1]/table[1]";
const rows = ["/tbody[1]/tr[1]", "/tbody[1]/tr[2]"].map((s) => table + s);
const nodes = [
  ["table", table],
  ["row", rows[0]],
  ["columnheader: Code", rows[0] + "/th[1]"],
  ["columnheader: Label", rows[0] + "/th[2]"],
  ["row", rows[1]],
  ["cell: C11", rows[1] + "/td[1]"],
  ["cell: Subpart (c)(ii) Reference", rows[1] + "/td[2]"],
];
const snapshot = {
  combinedTree: nodes.map(([role], i) => `[0-${i}] ${role}`).join("\n"),
  combinedXpathMap: Object.fromEntries(nodes.map(([, path], i) => [`0-${i}`, path!])),
  combinedUrlMap: {},
};

describe("table record projection", () => {
  it.each([
    [[1, 0], 1],
    [[], 2],
    ["invalid", 2],
  ] as const)(
    "accounts for the configured reader and bypasses the AX cache with rules %j",
    async (rules, count) => {
      const model = vi
        .fn()
        .mockResolvedValueOnce({
          role: "assistant",
          content: { type: "text", text: "rules" },
          outputFormat: "json_schema",
          structuredContent: { rules },
          usage: {
            inputTokens: 100,
            outputTokens: 10,
            totalTokens: 110,
            reasoningTokens: 2,
            cachedInputTokens: 20,
          },
        })
        .mockResolvedValueOnce({
          role: "assistant",
          content: { type: "text", text: "fallback" },
          outputFormat: "json_schema",
          structuredContent: { rows: [] },
          usage: {
            inputTokens: 200,
            outputTokens: 20,
            totalTokens: 220,
            reasoningTokens: 4,
            cachedInputTokens: 40,
          },
        });
      const get = vi.fn(),
        set = vi.fn(),
        frames = vi.fn();
      const page = {
        captureSnapshot: vi.fn().mockResolvedValue(snapshot),
        screenshot: vi.fn(),
        evaluate: vi.fn().mockResolvedValue(evidence),
        url: () => "https://example.com",
        frames,
        mainFrame: vi.fn(),
      };
      const data = await extract({
        params: {
          pageId: "main",
          instruction: task,
          schema: request.schema as Parameters<typeof extract>[0]["params"]["schema"],
        },
        model: { source: "client" },
        clientLLMGenerate: model,
        decisions: { apiKey: "unused" },
        page,
        logger: new StagehandLogger({ tracer: trace.getTracer("table-usage-test") }, () => {}),
        cache: {
          sessionId: "test",
          defaultCaching: true,
          client: { get, set } as unknown as import("../clients/cacheClient.js").CacheClient,
        },
      });
      expect(model).toHaveBeenCalledTimes(count);
      expect(data.metadata.usage).toMatchObject(
        count === 1
          ? { inputTokens: 100, outputTokens: 10, reasoningTokens: 2, cachedInputTokens: 20 }
          : { inputTokens: 300, outputTokens: 30, reasoningTokens: 6, cachedInputTokens: 60 },
      );
      expect(get).not.toHaveBeenCalled();
      expect(set).not.toHaveBeenCalled();
      expect(frames).not.toHaveBeenCalled();
    },
  );
  it("requires both sources to agree on visible rows and cell text", () => {
    expect(tableContext(snapshot, evidence)).toBeDefined();
    for (const tree of [
      snapshot.combinedTree.replace("Subpart (c)(ii)", "Subpart(c)(ii)"),
      snapshot.combinedTree.replace("Reference", "Reference!"),
      snapshot.combinedTree.replace("[0-4] row", "[0-4] generic"),
      snapshot.combinedTree + "\n[0-7] button: Next page",
    ])
      expect(tableContext({ ...snapshot, combinedTree: tree }, evidence)).toBeUndefined();
  });
  it("checks all rule indices before copying, preserving the requested keys and inline punctuation", async () => {
    const run = (rules: number[]) =>
      projectTable({ apiKey: "unused" }, task, request, evidence, [], async () => rules);
    expect(await run([1, 0])).toEqual({ rows: [{ label: "Subpart (c)(ii)", code: "C11" }] });
    for (const invalid of [[], [1], [1, 4], [1, 0, 0]]) expect(await run(invalid)).toBeUndefined();
  });
  it("keeps description continuations inside the copy boundary", async () => {
    const cell = { text: "Rules:\nA\nB\nReference", beforeLink: "Rules:\nA\nB" };
    const expanded = { ...evidence, rows: [[evidence.rows[0]![0]!, cell]] };
    const reader = vi.fn(async (state: string) => {
      const field = JSON.parse(state).fields[0];
      expect(field.rules).toHaveLength(2);
      return [1, 0];
    });
    expect(await projectTable({ apiKey: "unused" }, task, request, expanded, [], reader)).toEqual({
      rows: [{ label: "Rules:\nA\nB", code: "C11" }],
    });
  });
  it("exposes the exact rendered prefix each selected rule will copy", async () => {
    const first = "\u2002A\u00a0\u00a0B\u202f";
    const whole = first + "\nReference";
    const title = "Section\u00a0\u00a0one";
    const second = title + "\nSubtitle";
    const expanded = {
      ...evidence,
      rows: [
        [
          { text: " C11 ", beforeLink: " C11 " },
          { text: whole, beforeLink: first },
        ],
        [
          { text: "C12", beforeLink: "C12" },
          { text: second, beforeLink: second },
        ],
      ],
    };
    for (const [rule, labels] of [
      [whole, second],
      [first, second],
      [first, title],
    ].entries()) {
      const reader = async (state: string) => {
        const rows = JSON.parse(state).rows;
        for (const [i, label] of labels.entries()) {
          const parts: { text: string; ends: number[] }[] = rows[i][1];
          const end = parts.findIndex((p) => p.ends.includes(rule));
          expect(end).toBeGreaterThanOrEqual(0);
          expect(
            parts
              .slice(0, end + 1)
              .map((p) => p.text)
              .join(""),
          ).toBe(label);
        }
        return [rule, 0];
      };
      expect(await projectTable({ apiKey: "unused" }, task, request, expanded, [], reader)).toEqual(
        {
          rows: [
            { label: labels[0], code: " C11 " },
            { label: labels[1], code: "C12" },
          ],
        },
      );
    }
  });
  it("defers ambiguous header mappings before reading", async () => {
    const reader = vi.fn();
    const result = await projectTable(
      { apiKey: "unused" },
      task,
      request,
      { ...evidence, headers: ["Labels", "Label", "Code"] },
      [],
      reader,
    );
    expect(result).toBeUndefined();
    expect(reader).not.toHaveBeenCalled();
  });
});
