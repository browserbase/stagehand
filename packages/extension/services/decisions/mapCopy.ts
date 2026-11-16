import { type DecisionModelConfig } from "./client.js";
import { type JsonSchema, plan } from "./extractionSchema.js";
import { type TraceEntry, type ScalarReader } from "./extractionShared.js";
import { settleAll } from "./concurrency.js";
import { buildDataView } from "./dataView.js";
import { readScalars } from "./scalarMapping.js";
import { readList } from "./listMapping.js";

export async function mapCopyExtract(
  config: DecisionModelConfig,
  {
    instruction,
    schema,
    tree,
    urlMap,
    trace = [],
    reader,
  }: {
    instruction: string;
    schema: JsonSchema;
    tree: string;
    urlMap: Record<string, string>;
    trace?: TraceEntry[];
    reader?: ScalarReader;
  },
): Promise<{ data: Record<string, unknown>; trace: TraceEntry[]; verdict: Verdict }> {
  const { lists, scalars } = plan(schema);
  const view = buildDataView(tree, urlMap);
  // With one list and no other work in flight, a rejected group can fall back immediately.
  const stopOnDisagreement = lists.length === 1 && scalars.length === 0;
  const [scalarData, listData] = await settleAll([
    scalars.length
      ? readScalars(config, view, scalars, instruction, trace, reader)
      : Promise.resolve({}),
    settleAll(
      lists.map((list) => readList(config, view, list, instruction, trace, stopOnDisagreement)),
    ),
  ] as const);
  const data: Record<string, unknown> = { ...scalarData };
  lists.forEach((list, index) => {
    const items = listData[index];
    if (items === undefined) {
      if (list.required) throw new Error(`unresolved:${list.name}`);
      return;
    }
    data[list.name] = items;
  });
  const problems = structuralProblems({ lists, scalars }, data, trace);
  return { data, trace, verdict: { problems } };
}

export type Verdict = { problems: string[] };

function structuralProblems(
  { lists, scalars }: ReturnType<typeof plan>,
  data: Record<string, unknown>,
  trace: TraceEntry[],
): string[] {
  const problems = trace.filter((entry) => entry.step === "problem").map((entry) => entry.choice);
  for (const field of scalars) {
    const value = data[field.name];
    if (
      field.required &&
      (value === undefined || value === "" || (value === null && !field.nullable))
    )
      problems.push(`empty:${field.name}`);
  }
  for (const list of lists) {
    if (!list.required && data[list.name] === undefined) continue;
    const items = (data[list.name] ?? []) as unknown[];
    if (!items.length) problems.push(`empty:${list.name}`);
    if (!list.scalarItems && items.length) {
      for (const field of list.fields) {
        const missing = items.filter((item) => {
          const value = (item as Record<string, unknown>)[field.name];
          return value === "" || (value === null && !field.nullable) || value === undefined;
        }).length;
        if (field.required && missing / items.length > 0.5)
          problems.push(`mostly-empty:${list.name}.${field.name}`);
      }
    }
  }
  return problems;
}

export type { JsonSchema } from "./extractionSchema.js";
export type { TraceEntry, ScalarReader, ScalarReaderInput } from "./extractionShared.js";
export { tokens, numberCandidates, parseNumber } from "./extractionShared.js";
export { buildScalarReaderInput } from "./scalarMapping.js";
