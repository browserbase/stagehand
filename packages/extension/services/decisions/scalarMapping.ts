import {
  type DataView,
  type Fact,
  clip,
  buildDataView,
  type Group,
  recordText,
} from "./dataView.js";
import { type Field, fieldText, type ListPlan, type JsonSchema, plan } from "./extractionSchema.js";
import {
  tokens,
  overlap,
  type TraceEntry,
  type ScalarReader,
  NONE,
  ask,
  choiceOf,
  numberCandidates,
  valueFromFact,
  problem,
  type ScalarReaderInput,
  parseNumber,
  rankSlots,
  describeSlot,
  convert,
  readFieldSlot,
} from "./extractionShared.js";
import { settleAll } from "./concurrency.js";
import { type DecisionModelConfig, type DecisionQuestion } from "./client.js";
import { rankGroups, describeGroup } from "./listMapping.js";

// Keep the mapper and the independent reader on the same bounded evidence.
// Short prefix previews can hide the requested fact later in a paragraph.
const SCALAR_EVIDENCE_LIMIT = 1500;
const VERIFICATION_EVIDENCE_LIMIT = 8000;
const VERIFICATION_CONFIDENCE = 0.9;

function rankFacts(view: DataView, field: Field, instruction: string): Fact[] {
  const own = tokens(fieldText(field));
  const task = tokens(instruction);
  const numeric = field.type === "number" || field.type === "integer";
  const facts =
    numeric && view.numericNodes.size
      ? view.facts.map((fact) => {
          const node = view.numericNodes.get(fact.node.index);
          return node ? { ...fact, node, id: node.id, value: node.name } : fact;
        })
      : view.facts;
  const all = facts.filter((fact) =>
    field.type === "url" ? fact.url : numeric ? /\d/.test(fact.value) : true,
  );
  const main = all.filter((fact) => !fact.chrome);
  const usable = all;
  if (usable.length <= 40) return usable;
  const ranked = usable
    .map((fact) => {
      const label = tokens(fact.label);
      const value = tokens(fact.value);
      let score =
        3 * overlap(own, label) +
        2 * overlap(own, value) +
        0.5 * overlap(task, new Set([...label, ...value]));
      if ((field.type === "number" || field.type === "integer") && !/\d/.test(fact.value))
        score -= 2;
      if (fact.chrome) score *= 0.7;
      return { fact, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);
  const weak = (ranked[0]?.score ?? 0) < 3;
  const top = ranked.slice(0, weak ? 30 : 22).map(({ fact }) => fact);
  // Values often carry no words of the field ("Coframe" for a company name):
  // add the neighbours of the best label matches.
  const limit = weak ? 60 : 30;
  const picked = new Set(top);
  for (const anchor of top.slice(0, 4)) {
    const at = usable.indexOf(anchor);
    for (const neighbour of usable.slice(Math.max(0, at - 2), at + 3)) {
      if (picked.size >= limit) break;
      picked.add(neighbour);
    }
  }
  // Nothing on the page shares the field's words: let the model read the main content.
  for (const fact of usable) {
    if (picked.size >= limit) break;
    if (weak && (!fact.chrome || main.length < 5)) picked.add(fact);
  }
  return [...picked];
}

export async function readScalars(
  config: DecisionModelConfig,
  view: DataView,
  fields: Field[],
  instruction: string,
  trace: TraceEntry[],
  reader: ScalarReader | undefined,
  scalarOnly: boolean,
): Promise<Record<string, unknown>> {
  const options = new Map(fields.map((field) => [field.name, rankFacts(view, field, instruction)]));
  const questions: Record<string, DecisionQuestion> = {};
  for (const field of fields) {
    const facts = options.get(field.name)!;
    if (facts.length === 0) continue;
    questions[`f_${field.name}`] = {
      type: "choice",
      instructions: `Task: ${instruction}\nWhich page text holds "${fieldText(field)}"? Prefer an explicitly stated precise value over an approximate summary of the same fact. Do not calculate or infer an unstated value.`,
      criteria: {
        ...Object.fromEntries(
          facts.map((fact, i) => {
            return [
              `t${i}`,
              `${fact.label ? `[${clip(fact.label, 180)}] ` : ""}${clip(fact.value, SCALAR_EVIDENCE_LIMIT)}`,
            ];
          }),
        ),
        [NONE]: "None of these",
      },
    };
  }
  for (const field of fields) {
    if (field.required || !questions[`f_${field.name}`]) continue;
    const choice = questions[`f_${field.name}`];
    if (choice?.type !== "choice") continue;
    questions[`present_${field.name}`] = {
      type: "noul",
      instructions: `Task: ${instruction}\nDoes any candidate explicitly state the value of "${fieldText(field)}" as that particular fact? A related number in a name or another field is insufficient. Candidates: ${JSON.stringify(choice.criteria)}`,
    };
  }
  // Values that live in one item of a repeated group (a table row, a card) are
  // better read as a record: pick the item, then the part per field.
  const pseudo: ListPlan = {
    name: "item",
    description: "",
    fields,
    scalarItems: false,
    required: true,
  };
  const groups =
    fields.length > 1 || view.groups.length
      ? rankGroups(view, pseudo, instruction).slice(0, 6)
      : [];
  if (groups.length) {
    questions.record_group = {
      type: "choice",
      instructions: `Task: ${instruction}\nAre ALL the requested values (${fields.map(fieldText).join(", ")}) inside ONE single item of one of these repeated groups? If so, which group?`,
      criteria: {
        ...Object.fromEntries(groups.map((group) => [group.id, describeGroup(view, group)])),
        [NONE]: "No: the values are not all inside one item of a repeated group",
      },
    };
  }
  const readerTrace: TraceEntry[] = [];
  const [answers, read] = await settleAll([
    Object.keys(questions).length
      ? ask(config, { task: instruction }, questions).then((result) => result.answers)
      : {},
    reader
      ? readFromSheet(reader, fields, instruction, options, readerTrace, view.numericNodes.size > 0)
      : {},
  ] as const);

  const data: Record<string, unknown> = {};
  const ambiguous: Record<string, DecisionQuestion> = {};
  const candidatesFor = new Map<string, { value: number; shown: string }[]>();
  for (const field of fields) {
    const facts = options.get(field.name)!;
    const { choice } = choiceOf(answers, `f_${field.name}`, trace, field.name, facts.length + 1);
    const fact = choice === NONE ? undefined : facts[Number(choice.slice(1))];
    if (!fact) continue;
    const numeric = field.type === "number" || field.type === "integer";
    const candidates = numeric ? numberCandidates(fact.value) : [];
    if (candidates.length >= 2 && candidates.length <= 16) {
      candidatesFor.set(field.name, candidates);
      ambiguous[`n_${field.name}`] = {
        type: "choice",
        instructions: `Task: ${instruction}\nWhich bracketed number directly states "${fieldText(field)}" in the requested units? Choose none if no candidate states that value.`,
        criteria: {
          ...Object.fromEntries(candidates.map((candidate, i) => [`p${i}`, candidate.shown])),
          [NONE]: "No bracketed number directly states the requested value",
        },
      };
    }
    const value = valueFromFact(fact, field);
    if (value !== undefined) {
      data[field.name] = value;
      trace.push({
        step: `${field.name}:source`,
        choice: fact.id,
        confidence: 1,
        options: 1,
        sourceIds: [fact.id],
      });
    }
  }
  if (Object.keys(ambiguous).length) {
    const resolved = (await ask(config, { task: instruction }, ambiguous)).answers;
    for (const [name, candidates] of candidatesFor) {
      const answer = resolved[`n_${name}`];
      const { choice } = choiceOf(
        resolved,
        `n_${name}`,
        trace,
        `${name}:number`,
        candidates.length + 1,
      );
      if (answer?.type === "choice" && answer.choice === NONE) {
        delete data[name];
        problem(trace, `number-not-stated:${name}`);
      }
      if (choice.startsWith("p")) data[name] = candidates[Number(choice.slice(1))]!.value;
    }
  }

  if (groups.length) {
    const picked = choiceOf(answers, "record_group", trace, "record_group", groups.length + 1);
    const group = groups.find((candidate) => candidate.id === picked.choice);
    if (group) {
      const record = await readRecord(config, view, group, fields, instruction, trace);
      if (record) Object.assign(data, record);
    }
  }

  const needsVerification = new Map<Field, string | undefined>();
  if (reader) {
    trace.push(...readerTrace);
    for (const field of fields) {
      const name = field.name;
      if (field.type === "url") continue;
      const mapped = data[name];
      const located = Object.hasOwn(read, name) ? read[name] : undefined;
      if (located === undefined || mapped === undefined || mapped === "") {
        if (located !== undefined) data[name] = located;
        if (scalarOnly && data[name] !== undefined) needsVerification.set(field, undefined);
      } else if (!sameValue(mapped, located)) {
        // The mapper returns a whole fact. The span reader can isolate a requested
        // substring within it, but substring containment alone does not prove scope.
        if (
          scalarOnly &&
          typeof mapped === "string" &&
          typeof located === "string" &&
          mapped.includes(located)
        ) {
          data[name] = located;
          needsVerification.set(field, mapped);
        } else problem(trace, `scalar-disagree:${name}`);
      }
    }
  }

  for (const field of fields) {
    const presence = answers[`present_${field.name}`];
    if (
      !field.required &&
      data[field.name] !== undefined &&
      presence?.type === "noul" &&
      presence.noul < 0.5
    ) {
      delete data[field.name];
    }
  }

  for (const field of fields) {
    if (data[field.name] !== undefined || !field.required) continue;
    if (field.nullable) data[field.name] = null;
    else throw new Error(`unresolved:${field.name}`);
  }
  const disputed = [...needsVerification].filter(([field]) => data[field.name] !== undefined);
  if (disputed.length && !trace.some((entry) => entry.step === "problem")) {
    await verifyScalarReadings(config, view, instruction, options, data, disputed, trace);
  }
  return data;
}

async function verifyScalarReadings(
  config: DecisionModelConfig,
  view: DataView,
  instruction: string,
  options: Map<string, Fact[]>,
  data: Record<string, unknown>,
  disputed: [Field, string | undefined][],
  trace: TraceEntry[],
): Promise<void> {
  const page = view.nodes
    .filter((node) => node.name)
    .map((node) => node.name)
    .join("\n");
  const evidence =
    page.length <= VERIFICATION_EVIDENCE_LIMIT
      ? page
      : scalarReaderEvidence(
          disputed.map(([field]) => field),
          instruction,
          options,
        ).input.sheet.slice(0, VERIFICATION_EVIDENCE_LIMIT);
  const questions: Record<string, DecisionQuestion> = Object.create(null);
  for (const [field, whole] of disputed) {
    const value = JSON.stringify(data[field.name]);
    questions[field.name] =
      whole === undefined
        ? {
            type: "choice",
            instructions: `Is ${value} the correct, complete value for "${fieldText(field)}" as requested? Check the entity, units, and requested representation against the page.`,
            criteria: {
              yes: "The evidence establishes the exact answer.",
              no: "Wrong or insufficient evidence.",
            },
          }
        : {
            type: "choice",
            instructions: `Which candidate exactly answers "${fieldText(field)}" for the task? Check whether the request calls for the whole text or just a part. Select neither if the entity, scope, or requested format differs.`,
            criteria: {
              full: JSON.stringify(whole),
              span: value,
              none: "Neither candidate is the complete requested value.",
            },
          };
  }
  const verification = await ask(config, { task: instruction, evidence }, questions);
  for (const [field, whole] of disputed) {
    const name = field.name;
    const verified = choiceOf(
      verification.answers,
      name,
      trace,
      `${name}:verified`,
      whole === undefined ? 2 : 3,
    );
    // A strong contrary vote can veto one witness. Reversing a disagreement
    // requires a strong vote for one of the two exact copies.
    if (whole === undefined) {
      if (verified.choice === "no" && verified.confidence >= VERIFICATION_CONFIDENCE)
        problem(trace, `unverified:${name}`);
    } else if (verified.confidence < VERIFICATION_CONFIDENCE || verified.choice === NONE) {
      problem(trace, `unverified:${name}`);
    } else if (verified.choice === "full") {
      data[name] = whole;
    }
  }
}

export async function verifyScalarMagnitude(
  config: DecisionModelConfig,
  view: DataView,
  field: Field,
  value: number,
  instruction: string,
  trace: TraceEntry[],
): Promise<string | undefined> {
  // A record read can replace the initial scalar choice. Check the source of the final value.
  const source = trace.findLast((entry) => entry.step === `${field.name}:source`);
  const id = source?.sourceIds?.[0];
  if (!id) return;
  const fact = view.facts.find((candidate) => candidate.id === id);
  const text = fact?.value ?? view.nodes.find((node) => node.id === id)?.name;
  if (!text || !/\dm\b/u.test(text)) return;

  const { answers } = await ask(
    config,
    { task: instruction, ...(fact && { label: fact.label }), source: text, proposedValue: value },
    {
      magnitude: {
        type: "choice",
        instructions: `Read the source in context. Does it state ${value} for "${fieldText(field)}" in the requested units? A compact m can denote metres or millions.`,
        criteria: {
          supported: "The stated quantity equals the proposed value in the requested units",
          [NONE]: "Different quantity, different scale, or insufficient evidence",
        },
      },
    },
  );
  const { choice } = choiceOf(answers, "magnitude", trace, `${field.name}:magnitude`, 2);
  if (choice !== "supported") return `unsupported-magnitude:${field.name}`;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a === "number" || typeof b === "number") return Number(a) === Number(b);
  const normal = (value: unknown) => String(value).toLowerCase().replace(/\s+/g, " ").trim();
  const [x, y] = [normal(a), normal(b)];
  return x === y;
}

function scalarReaderEvidence(fields: Field[], instruction: string, options: Map<string, Fact[]>) {
  const facts = [...new Set(fields.flatMap((field) => options.get(field.name) ?? []))].sort(
    (a, b) => a.node.index - b.node.index,
  );
  const scalarFields = fields.filter((field) => field.type !== "url");
  const input: ScalarReaderInput = {
    sheet: facts
      .map(
        (fact) =>
          `${fact.label ? `${clip(fact.label, 180)}: ` : ""}${clip(fact.value, SCALAR_EVIDENCE_LIMIT)}`,
      )
      .join("\n"),
    fields: scalarFields.map((field) => ({
      name: field.name,
      type: field.type === "string" ? "string" : "number",
      instructions: `${instruction}\nFind the exact value for ${fieldText(field)}. Prefer an explicitly stated precise value over an approximate summary of the same fact. Do not calculate or infer an unstated value.`,
    })),
  };
  return { facts, scalarFields, input };
}

export function buildScalarReaderInput(
  schema: JsonSchema,
  tree: string,
  urlMap: Record<string, string>,
  instruction: string,
): ScalarReaderInput {
  const view = buildDataView(tree, urlMap);
  const { scalars } = plan(schema);
  const options = new Map(
    scalars.map((field) => [field.name, rankFacts(view, field, instruction)]),
  );
  return scalarReaderEvidence(scalars, instruction, options).input;
}

/**
 * The candidate facts of every field, one "label: value" line each in page
 * order, read by a span/field extractor. A value counts only if it occurs in
 * the sheet, so the reader cannot invent one.
 */
async function readFromSheet(
  reader: ScalarReader,
  fields: Field[],
  instruction: string,
  options: Map<string, Fact[]>,
  trace: TraceEntry[],
  hasNumericProjections: boolean,
): Promise<Record<string, unknown>> {
  const { facts, scalarFields, input } = scalarReaderEvidence(fields, instruction, options);
  if (!facts.length || !scalarFields.length) return {};
  const answers = await reader(input);
  const normal = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();
  const data: Record<string, unknown> = {};
  for (const field of scalarFields) {
    const raw = answers[field.name];
    if (raw === null || raw === undefined || raw === "") continue;
    const value =
      field.type === "string"
        ? String(raw).trim()
        : typeof raw === "number"
          ? raw
          : parseNumber(raw, tokens(fieldText(field)));
    if (value === undefined) continue;
    // On pages with split exponents, the sheet can contain both the literal
    // and its original text for a string field. Verify against the requested representation.
    const evidence = hasNumericProjections ? options.get(field.name)! : facts;
    const sources = evidence.filter((fact) =>
      typeof value === "number"
        ? numberCandidates(fact.value).some((candidate) => candidate.value === value)
        : normal(fact.value).includes(normal(value)),
    );
    if (!sources.length) continue;
    data[field.name] = value;
    trace.push({
      step: `${field.name}:reader`,
      choice: clip(String(value), 40),
      confidence: 1,
      options: facts.length,
      sourceIds: sources.map((fact) => fact.id),
    });
  }
  return data;
}

async function readRecord(
  config: DecisionModelConfig,
  view: DataView,
  group: Group,
  fields: Field[],
  instruction: string,
  trace: TraceEntry[],
): Promise<Record<string, unknown> | undefined> {
  const wanted = tokens(instruction);
  const candidates = group.records
    .map((record, index) => ({
      record,
      index,
      score: overlap(
        wanted,
        tokens(`${group.context[index] ?? ""} ${recordText(view, record, 300)}`),
      ),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 40);
  const slotOptions = new Map(fields.map((field) => [field.name, rankSlots(group.slots, field)]));
  const questions: Record<string, DecisionQuestion> = {
    record: {
      type: "choice",
      instructions: `Task: ${instruction}\nWhich single item holds the requested values?`,
      criteria: {
        ...Object.fromEntries(
          candidates.map(({ record, index }) => [
            `r${index}`,
            `${group.context[index] ? `[${clip(group.context[index]!, 50)}] ` : ""}${recordText(view, record, 200)}`,
          ]),
        ),
        [NONE]: "None of these items",
      },
    },
  };
  for (const field of fields) {
    questions[`f_${field.name}`] = {
      type: "choice",
      instructions: `Task: ${instruction}\nIn each item, which part holds "${fieldText(field)}"? Prefer the part that holds just this value, without extra text.`,
      criteria: {
        ...Object.fromEntries(
          slotOptions.get(field.name)!.map((slot, i) => [`s${i}`, describeSlot(slot, field)]),
        ),
        [NONE]: "Not present in the items",
      },
    };
  }
  const { answers } = await ask(
    config,
    {
      task: instruction,
      items: candidates.slice(0, 3).map(({ record }) => recordText(view, record, 300)),
    },
    questions,
  );
  const pickedRecord = choiceOf(answers, "record", trace, "record", candidates.length + 1);
  const record = group.records[Number(pickedRecord.choice.slice(1))];
  if (!record || pickedRecord.choice === NONE) return undefined;
  const values: Record<string, unknown> = {};
  const usedSlots = new Set<string>();
  for (const field of fields) {
    const slots = slotOptions.get(field.name)!;
    const { choice } = choiceOf(
      answers,
      `f_${field.name}`,
      trace,
      `record.${field.name}`,
      slots.length + 1,
    );
    const slot = choice === NONE ? undefined : slots[Number(choice.slice(1))];
    if (!slot) continue;
    // Two fields read from the same part means the values are not one item's columns.
    if (usedSlots.has(slot.key)) return undefined;
    usedSlots.add(slot.key);
    const source = readFieldSlot(view, record, slot.key, field);
    const value = convert(view, source, field);
    if (value !== undefined) {
      values[field.name] = value;
      trace.push({
        step: `${field.name}:source`,
        choice: slot.key,
        confidence: 1,
        options: 1,
        recordId: record.id,
        sourceIds: source ? [source.id] : [],
      });
    }
  }
  return values;
}
