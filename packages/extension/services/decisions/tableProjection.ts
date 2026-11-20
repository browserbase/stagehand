import { decide, type DecisionModelConfig } from "./client.js";
import type { JsonSchema } from "./extractionSchema.js";

import type { ColumnCell, TableEvidence, TableScope } from "./tableEvidence.js";

export function tableRequest(instruction: string, schema: JsonSchema) {
  if (!/\b(?:all|every|each)\b/i.test(instruction)) return;
  const years = /\b(\d{4})\s*(?:through|to|[-–])\s*(\d{4})\b/i.exec(instruction);
  if (!years && !/\btable\b/i.test(instruction)) return;
  const entries = Object.entries(schema.properties ?? {});
  if (schema.type !== "object" || entries.length !== 1) return;
  const [key, list] = entries[0]!;
  if (!schema.required?.includes(key) || list.type !== "array" || list.items?.type !== "object")
    return;
  const fields = Object.entries(list.items.properties ?? {});
  if (
    fields.length < 2 ||
    fields.length > 8 ||
    !fields.every(
      ([key, field]) =>
        list.items?.required?.includes(key) && field.type === "string" && !field.format,
    )
  )
    return;
  const scope: TableScope = {};
  if (years) {
    const bounds = [Number(years[1]), Number(years[2])];
    scope.years = [Math.min(...bounds), Math.max(...bounds)];
    if (scope.years[1] - scope.years[0] > 30) return;
  }
  return { key, fields, scope, schema };
}

type Projection = { rule: string; values: string[] };
export type TableReader = (evidence: string) => Promise<number[]>;

function headerWords(text: string): string[] {
  return (
    text
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .match(/[\p{L}\d]+/gu) ?? []
  ).map((w) => w.replace(/s$/, ""));
}

function columnFor(field: string, headers: string[]): number | undefined {
  const words = headerWords(field);
  const names = headers.map(headerWords);
  if (!words.length) return;
  const exact = names.flatMap((name, i) => (name.join(" ") === words.join(" ") ? [i] : []));
  if (exact.length) return exact.length === 1 ? exact[0] : undefined;
  const candidates = names.flatMap((name, i) =>
    name.length && (name.every((w) => words.includes(w)) || words.every((w) => name.includes(w)))
      ? [i]
      : [],
  );
  return candidates.length === 1 ? candidates[0] : undefined;
}

function projections(cells: ColumnCell[]): Projection[] {
  const candidates = [
    { rule: "whole rendered cell verbatim", values: cells.map((c) => c.text) },
    {
      rule: "before a standalone link, otherwise whole cell",
      values: cells.map((c) => c.beforeLink),
    },
  ];
  // A short secondary label may share a cell with its value. A multiline description can
  // contain a substantive list or a paragraph continuation after its first rendered line.
  const lines = cells.map((c) => c.text.split(/\n+/u));
  if (lines.every((parts) => parts.length <= 2 && (parts[1]?.length ?? 0) <= 80)) {
    candidates.push({
      rule: "first line of a single value or short line pair",
      values: lines.map((parts) => parts[0]!),
    });
  }
  return candidates.filter(
    (c, i) => !candidates.slice(0, i).some((p) => p.values.every((v, r) => v === c.values[r])),
  );
}

export async function projectTable(
  config: DecisionModelConfig,
  instruction: string,
  request: NonNullable<ReturnType<typeof tableRequest>>,
  evidence: TableEvidence,
  context: string[],
  reader?: TableReader,
) {
  const fields: { field: string; description: string; column: number; options: Projection[] }[] =
    [];
  const used = new Set<number>();
  for (const [field, desc] of request.fields) {
    const column = columnFor(field, evidence.headers);
    if (column === undefined || used.has(column)) return;
    used.add(column);
    fields.push({
      field,
      description: desc.description ?? "",
      column,
      options: projections(evidence.rows.map((row) => row[column]!)),
    });
  }
  const state = JSON.stringify({
    instruction,
    schema: request.schema,
    page: evidence.title,
    outsideTables: context,
    sections: evidence.groups,
    columns: evidence.headers,
    fields: fields.map(({ field, description, column, options }) => ({
      field,
      description,
      column,
      rules: options.map((o) => o.rule),
    })),
    rows: evidence.rows.map((row, r) =>
      row.map((c, i) => {
        const options = fields.find((f) => f.column === i)?.options;
        if (!options || options.length === 1) return c.text;
        // Encode shared prefixes once. Each part ends at one or more candidate copy boundaries.
        const whole = options[0]!.values[r]!;
        const ends = [...new Set(options.map((o) => o.values[r]!.length))].sort((a, b) => a - b);
        return ends.map((end, j) => ({
          text: whole.slice(j ? ends[j - 1]! : 0, end),
          ends: options.flatMap((o, k) => (o.values[r]!.length === end ? [k] : [])),
        }));
      }),
    ),
  });
  if (state.length > 32000) return;

  let rules = fields.map(() => 0);
  if (request.scope.years || fields.some((f) => f.options.length > 1)) {
    if (!reader) return;
    const selected = await reader(state);
    if (selected.length !== fields.length) return;
    rules = selected;
  } else {
    const { answers } = await decide(config, state, {
      scope: {
        type: "choice",
        instructions:
          "Can every requested field be copied verbatim from the proposed column for every supplied row in source order? Check the complete instruction, field descriptions, units, all rows, and outside-table text. Reject any missing fact, calculation, sorting, subset, or continuation elsewhere.",
        criteria: {
          copy: "Copy every row as proposed",
          reject: "Different scope or any unsupported field or transformation",
        },
      },
    });
    const a = answers.scope;
    if (a?.type !== "choice" || a.choice !== "copy" || a.confidence < 0.8) return;
  }
  const values: string[][] = [];
  for (const [i, f] of fields.entries()) {
    const option = f.options[rules[i]!];
    if (
      !option ||
      option.values.some(
        (v) => !v.trim() || /^(?:[-–—]+|n\/?a|not available|unknown|null)$/iu.test(v.trim()),
      )
    )
      return;
    values.push(option.values);
  }
  return {
    [request.key]: evidence.rows.map((_, r) =>
      Object.fromEntries(fields.map((f, i) => [f.field, values[i]![r]!])),
    ),
  };
}
