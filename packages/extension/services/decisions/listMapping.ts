import { type DataView, type Group, recordText, clip, type Slot, readSlot } from "./dataView.js";
import { type ListPlan, fieldText, type Field } from "./extractionSchema.js";
import {
  tokens,
  overlap,
  rankSlots,
  describeSlot,
  NONE,
  countOptions,
  type TraceEntry,
  ask,
  choiceOf,
  noulOf,
  problem,
  numberCandidates,
  convert,
} from "./extractionShared.js";
import { type DecisionQuestion, type DecisionModelConfig } from "./client.js";
import { type OutlineNode } from "./outline.js";

export function rankGroups(view: DataView, list: ListPlan, instruction: string): Group[] {
  const wanted = tokens(
    [instruction, list.name, list.description, ...list.fields.map(fieldText)].join(" "),
  );
  const ranked = view.groups
    .map((group) => {
      const rich = group.slots.filter((slot) => slot.coverage >= 0.5).length;
      const text = [
        ...group.slots.map((slot) => slot.label ?? ""),
        ...group.records.slice(0, 3).map((record) => recordText(view, record, 200)),
        group.context[0] ?? "",
      ].join(" ");
      const score =
        Math.sqrt(group.records.length) * Math.min(rich, 8) * (1 + overlap(wanted, tokens(text)));
      return { group, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ group }) => group);
  const shortlist = ranked.slice(0, 8);
  // A long manual can have thousands of paragraphs. Reserve a slot for a
  // complete label sequence whose heading matches the requested scalar list.
  if (list.scalarItems) {
    const matchingLabels = ranked.find(
      (group) =>
        group.role === "label" &&
        group.sections.some((heading) => {
          const label = tokens(heading);
          return label.size > 0 && overlap(wanted, label) === label.size;
        }),
    );
    if (matchingLabels && !shortlist.includes(matchingLabels))
      shortlist.splice(7, 1, matchingLabels);
  }
  return shortlist;
}

export function describeGroup(view: DataView, group: Group): string {
  const where = group.sections.length
    ? ` in ${group.sections.length} sections (${clip(group.sections.filter(Boolean).slice(0, 3).join("; "), 80)})`
    : group.context[0]
      ? ` under "${clip(group.context[0], 50)}"`
      : "";
  const examples = group.records
    .slice(0, 2)
    .map((record, i) => `item ${i + 1}: ${recordText(view, record, 150)}`)
    .join(" / ");
  return `${group.records.length} items${where}. ${examples}`;
}

function buildListMapping(view: DataView, list: ListPlan, instruction: string, group: Group) {
  const hasNumericField = list.fields.some(
    (field) => field.type === "number" || field.type === "integer",
  );
  const textSpans = [
    {
      read: (text: string) => textAfterNumericPrefix(text, hasNumericField),
      label: "Text after the leading numeric identifier in the same label",
    },
    { read: callableIdentifier, label: "Identifier before the opening parenthesis" },
  ];
  const slotOptions = new Map(
    list.fields.map((field) => [
      field.name,
      rankSlots(group.slots, field).flatMap((slot) => {
        const whole = { slot, readText: undefined, description: describeSlot(slot, field) };
        if (field.type !== "string" || slot.samples.length < 2) return [whole];
        return [
          whole,
          ...textSpans.flatMap(({ read, label }) => {
            const samples = slot.samples.map(read);
            return samples.every((sample) => sample !== undefined)
              ? [
                  {
                    slot,
                    readText: read,
                    description: `${label}, ${describeSlot({ ...slot, samples }, field)}`,
                  },
                ]
              : [];
          }),
        ];
      }),
    ]),
  );
  const questions: Record<string, DecisionQuestion> = {};
  for (const field of list.fields) {
    const slots = slotOptions.get(field.name)!;
    questions[`f_${field.name}`] = {
      type: "choice",
      instructions: `Task: ${instruction}\nIn each item, which part holds "${fieldText(field)}"? Prefer the part that holds just this value, without extra text.`,
      criteria: {
        ...Object.fromEntries(slots.map((option, i) => [`s${i}`, option.description])),
        [NONE]: "Not present in the items",
      },
    };
    const sparse = slots.filter((option) => option.slot.coverage < 0.5);
    if (!list.scalarItems && sparse.length)
      questions[`inherit_${field.name}`] = {
        type: "noul",
        instructions: `Task: ${instruction}\nIs "${fieldText(field)}" a shared heading or label that applies to subsequent items in the same section when it is not repeated? Do not inherit values stated only for an individual item, including optional facts. Sparse parts: ${sparse.map((option) => option.description).join("; ")}`,
      };
  }
  const counts = countOptions(instruction);
  if (counts.length) {
    questions.count = {
      type: "choice",
      instructions: `Task: ${instruction}\nDoes the task ask for a fixed number of items? The page has ${group.records.length}.`,
      criteria: {
        ...Object.fromEntries(counts.map((n) => [`c${n}`, `Exactly ${n} items`])),
        all: "No fixed number: every item that matches the task",
      },
    };
  }
  const sections = [...new Set(group.context.filter(Boolean))];
  const bySection =
    sections.length >= 2 && sections.length <= Math.min(24, group.records.length / 2);
  questions.subset = {
    type: "noul",
    instructions: `Task: ${instruction}\nThe page has ${group.records.length} such items${bySection ? ` under these section labels: ${clip(sections.join("; "), 400)}` : ""}. Within this already selected group, does the task ask for only some of its items? A request for all items in this particular group does not ask for a subset just because other groups on the page should be excluded.`,
  };
  if (bySection) {
    const listing = clip(sections.map((section, i) => `${i + 1}. ${section}`).join("; "), 500);
    sections.forEach((section, i) => {
      questions[`sec${i}`] = {
        type: "noul",
        instructions: `Task: ${instruction}\nThe items are grouped under these section labels, in page order: ${listing}.\nShould the items under "${clip(section, 80)}" be included in the result?`,
      };
    });
    if (sections.length >= 3) {
      const options = Object.fromEntries(
        sections.map((section, i) => [`x${i}`, clip(section, 80)]),
      );
      for (const end of ["first", "last"] as const) {
        questions[`range_${end}`] = {
          type: "choice",
          instructions: `Task: ${instruction}\nThe items are grouped under these section labels, in page order: ${listing}.\nIf the task asks for a contiguous run of these sections (a range), which section is the ${end} one in that run?`,
          criteria: { ...options, [NONE]: "The task does not ask for a range of sections" },
        };
      }
    }
  }
  const preview = group.records.slice(0, 3).map((record) => recordText(view, record, 300));
  return { slotOptions, counts, sections, bySection, preview, questions };
}

async function chooseListGroup(
  config: DecisionModelConfig,
  view: DataView,
  list: ListPlan,
  instruction: string,
  groups: Group[],
  trace: TraceEntry[],
  stopOnDisagreement: boolean,
): Promise<Group | undefined> {
  const groupStarted = performance.now();
  const questions = listGroupQuestions(view, list, instruction, groups);
  const first = await ask(config, { task: instruction }, questions);
  trace.push({
    step: `${list.name}:group-ms`,
    choice: "group",
    confidence: Math.round(performance.now() - groupStarted),
    options: 0,
  });
  const picked = choiceOf(first.answers, "group", trace, `${list.name}:group`, groups.length + 1);
  const group = groups.find((candidate) => candidate.id === picked.choice);
  const pointwise = groups.map((candidate) => ({
    id: candidate.id,
    yes: noulOf(first.answers, `is_${candidate.id}`),
  }));
  const best = pointwise.toSorted((a, b) => b.yes - a.yes)[0];
  trace.push({
    step: `${list.name}:group-pointwise`,
    choice: best?.id ?? NONE,
    confidence: best?.yes ?? 0,
    options: groups.length,
  });
  if (group && best && (best.id !== group.id || best.yes < 0.5)) {
    const reason = `group-disagree:${list.name}`;
    problem(trace, reason);
    if (stopOnDisagreement) throw new Error(reason);
  }
  return group;
}

function listGroupQuestions(view: DataView, list: ListPlan, instruction: string, groups: Group[]) {
  const want = list.fields.map(fieldText).join(", ");
  const listName = list.name.replaceAll("_", " ");
  const descriptions = groups.map((group) => [group.id, describeGroup(view, group)] as const);
  const questions: Record<string, DecisionQuestion> = {
    group: {
      type: "choice",
      instructions: `Task: ${instruction}\nWhich group of repeated page items is the "${listName}" list? Each item must provide: ${want}.`,
      criteria: { ...Object.fromEntries(descriptions), [NONE]: "None of these groups" },
    },
  };
  for (const [id, description] of descriptions) {
    questions[`is_${id}`] = {
      type: "noul",
      instructions: `Task: ${instruction}\nAre these repeated page items the "${listName}" list (each item provides: ${want})? ${description}`,
    };
  }
  return questions;
}

export async function readList(
  config: DecisionModelConfig,
  view: DataView,
  list: ListPlan,
  instruction: string,
  trace: TraceEntry[],
  stopOnDisagreement: boolean,
): Promise<unknown[] | undefined> {
  const groups = rankGroups(view, list, instruction);
  if (!groups.length) return undefined;
  const group = await chooseListGroup(
    config,
    view,
    list,
    instruction,
    groups,
    trace,
    stopOnDisagreement,
  );
  if (!group) return undefined;
  trace.push({
    step: `${list.name}:page-items`,
    choice: String(group.records.length),
    confidence: 0,
    options: 0,
  });

  const mappingStarted = performance.now();
  const mappingRequest = buildListMapping(view, list, instruction, group);
  const { slotOptions, counts, sections, bySection } = mappingRequest;
  const { answers } = await ask(
    config,
    { task: instruction, items: mappingRequest.preview },
    mappingRequest.questions,
  );
  trace.push({
    step: `${list.name}:mapping-ms`,
    choice: "sequential",
    confidence: Math.round(performance.now() - mappingStarted),
    options: 0,
  });

  const mapping = new Map<string, Slot | undefined>();
  const textReaders = new Map<string, (text: string) => string | undefined>();
  for (const field of list.fields) {
    const slots = slotOptions.get(field.name)!;
    const { choice } = choiceOf(
      answers,
      `f_${field.name}`,
      trace,
      `${list.name}.${field.name}`,
      slots.length + 1,
    );
    const option = choice === NONE ? undefined : slots[Number(choice.slice(1))];
    const linked = slots.filter((candidate) => candidate.slot.link);
    const slot =
      option?.slot ?? (field.type === "url" && linked.length === 1 ? linked[0]?.slot : undefined);
    mapping.set(field.name, slot);
    if (option?.readText) textReaders.set(field.name, option.readText);
  }
  if (list.fields.every((field) => !mapping.get(field.name))) return undefined;

  let records = group.records.map((record, index) => ({ record, index }));
  const countChoice = counts.length
    ? choiceOf(answers, "count", trace, `${list.name}:count`, counts.length + 1).choice
    : "all";
  const count = countChoice.startsWith("c") ? Number(countChoice.slice(1)) : undefined;
  const subset = count === undefined && noulOf(answers, "subset") > 0.5;
  trace.push({
    step: `${list.name}:subset`,
    choice: String(subset),
    confidence: noulOf(answers, "subset"),
    options: 2,
  });
  if (bySection) {
    const votes = sections.map((_, i) => noulOf(answers, `sec${i}`));
    trace.push({
      step: `${list.name}:section-votes`,
      choice: sections
        .map((section, i) => `${clip(section, 20)}=${votes[i]!.toFixed(2)}`)
        .join("|"),
      confidence: 0,
      options: sections.length,
    });
    const decisive = votes.some((vote) => vote >= 0.8) && votes.some((vote) => vote <= 0.2);
    if (subset || decisive) {
      const keep = new Set(sections.filter((_, i) => votes[i]! >= 0.5));
      if (sections.length >= 3) {
        const firstEnd = choiceOf(
          answers,
          "range_first",
          trace,
          `${list.name}:range_first`,
          sections.length + 1,
        ).choice;
        const lastEnd = choiceOf(
          answers,
          "range_last",
          trace,
          `${list.name}:range_last`,
          sections.length + 1,
        ).choice;
        if (firstEnd !== NONE && lastEnd !== NONE) {
          const from = Number(firstEnd.slice(1));
          const to = Number(lastEnd.slice(1));
          for (let i = Math.min(from, to); i <= Math.max(from, to); i++) keep.add(sections[i]!);
        }
      }
      trace.push({
        step: `${list.name}:sections`,
        choice: [...keep].join("|"),
        confidence: keep.size,
        options: sections.length,
      });
      if (keep.size > 0)
        records = records.filter(({ index }) => keep.has(group.context[index] ?? ""));
    }
  }
  if (count !== undefined) {
    // "The 10 most populous": a leading total or header-like row must not take a place.
    const window = records.slice(0, Math.min(records.length, count + 5));
    if (records.length > count) {
      const check = await ask(
        config,
        { task: instruction },
        Object.fromEntries(
          window.map(({ record, index }) => [
            `r${index}`,
            {
              type: "noul",
              instructions: `Task: ${instruction}\nIs this item one of the things the task asks for (not a total, summary or heading row)? Item: ${recordText(view, record, 220)}`,
            } satisfies DecisionQuestion,
          ]),
        ),
      );
      records = window.filter(({ index }) => noulOf(check.answers, `r${index}`) >= 0.5);
    }
    if (records.length < count)
      problem(trace, `count-short:${list.name}:${records.length}/${count}`);
    records = records.slice(0, count);
  } else if (subset) {
    const third = await ask(
      config,
      { task: instruction },
      Object.fromEntries(
        records.map(({ record, index }) => [
          `r${index}`,
          {
            type: "noul",
            instructions: `Task: ${instruction}\nThis record belongs to the already selected group, ${describeGroup(view, group)}. Judge inclusion based on the request within that group. Similar text elsewhere does not change this record's membership. Should this item be included? Item ${index + 1} of ${group.records.length}: ${recordText(view, record, 220)}`,
          } satisfies DecisionQuestion,
        ]),
      ),
    );
    trace.push({
      step: `${list.name}:filter`,
      choice: "subset",
      confidence: noulOf(answers, "subset"),
      options: records.length,
    });
    records = records.filter(({ index }) => noulOf(third.answers, `r${index}`) >= 0.5);
  }

  // A value holding several numbers ("829.8 m (2,722 ft)", "20 February 1991"):
  // the model says which position holds the field, read once from a sample.
  const position = new Map<string, number>();
  {
    const questionsN: Record<string, DecisionQuestion> = {};
    const samples = new Map<string, { value: number; shown: string }[]>();
    for (const field of list.fields) {
      const slot = mapping.get(field.name);
      if (!slot || (field.type !== "number" && field.type !== "integer")) continue;
      const texts = records
        .slice(0, 5)
        .map(({ record }) => readSlot(view, record, slot.key)?.name ?? "");
      const sample = texts.map(numberCandidates).find((candidates) => candidates.length >= 2);
      if (!sample || sample.length > 12) continue;
      samples.set(field.name, sample);
      questionsN[`n_${field.name}`] = {
        type: "choice",
        instructions: `Task: ${instruction}\nIn this item's value, which bracketed number is "${fieldText(field)}"?`,
        criteria: Object.fromEntries(sample.map((candidate, i) => [`p${i}`, candidate.shown])),
      };
    }
    if (Object.keys(questionsN).length) {
      const { answers } = await ask(config, { task: instruction }, questionsN);
      for (const name of samples.keys()) {
        const { choice } = choiceOf(
          answers,
          `n_${name}`,
          trace,
          `${list.name}.${name}:number`,
          samples.get(name)!.length,
        );
        if (choice.startsWith("p")) position.set(name, Number(choice.slice(1)));
      }
    }
  }

  const chosen = [...mapping.values()].filter((slot): slot is Slot => slot !== undefined);
  const urlSlots = new Set(
    list.fields.filter((field) => field.type === "url").map((field) => mapping.get(field.name)),
  );
  const missing = new Map<string, number>();
  const carried = new Map<string, string | number | undefined>();
  const carriedSources = new Map<string, string>();
  let previousContext: string | undefined;
  const items = records.map(({ record, index }) => {
    const context = group.context[index] ?? "";
    if (context !== previousContext) {
      carried.clear();
      carriedSources.clear();
      previousContext = context;
    }
    const item: Record<string, unknown> = {};
    for (const field of list.fields) {
      const slot = mapping.get(field.name);
      const inner = slot
        ? chosen.filter(
            (other) =>
              other !== slot &&
              !urlSlots.has(other) &&
              (slot.key === "." || other.key.startsWith(`${slot.key}/`)),
          )
        : [];
      const readText = textReaders.get(field.name);
      let value =
        slot && readText
          ? readText(readSlot(view, record, slot.key)?.name ?? "")
          : slot && inner.length && field.type === "string"
            ? residual(
                view,
                record,
                slot.key,
                inner.map((other) => other.key),
              )
            : slot
              ? position.has(field.name)
                ? numberCandidates(readSlot(view, record, slot.key)?.name ?? "")[
                    position.get(field.name)!
                  ]?.value
                : convert(view, readSlot(view, record, slot.key), field, true)
              : undefined;
      let sourceId = slot ? readSlot(view, record, slot.key)?.id : undefined;
      if (
        slot &&
        slot.coverage < 0.5 &&
        !list.scalarItems &&
        noulOf(answers, `inherit_${field.name}`) >= 0.8
      ) {
        if (value === undefined) {
          value = carried.get(field.name);
          sourceId = carriedSources.get(field.name);
        } else {
          carried.set(field.name, value);
          if (sourceId) carriedSources.set(field.name, sourceId);
        }
      }
      if (typeof value === "string" && field.type === "string") value = fitExample(value, field);
      if (value !== undefined) {
        item[field.name] = value;
        trace.push({
          step: `${list.name}.${field.name}:source`,
          choice: slot?.key ?? NONE,
          confidence: 1,
          options: 1,
          recordId: record.id,
          sourceIds: sourceId ? [sourceId] : [],
        });
      } else if (field.required && field.nullable) {
        item[field.name] = null;
      } else if (field.required) {
        missing.set(field.name, (missing.get(field.name) ?? 0) + 1);
      }
    }
    return list.scalarItems ? item[list.fields[0]!.name] : item;
  });
  for (const [field, count] of missing)
    problem(trace, `missing:${list.name}.${field}:${count}/${items.length}`);
  return items;
}

function textAfterNumericPrefix(label: string, allowBareInteger: boolean): string | undefined {
  const text = label.replace(/\s+/g, " ").trim();
  const section = /^\d+(?:\.\d+)*\.\s+(\p{L}.*)$/u.exec(text);
  if (section || !allowBareInteger) return section?.[1];
  return /^\d+\s+(\p{L}.*)$/u.exec(text)?.[1];
}

function callableIdentifier(text: string): string | undefined {
  return /^\s*([\p{L}_$][\p{L}\p{N}_$]*(?:\.[\p{L}_$][\p{L}\p{N}_$]*)*)\s*\(/u.exec(text)?.[1];
}

/**
 * The schema's own example ("For example, GG 12345") fixes the value's shape:
 * a copied "GG 51526 Notice 5533" keeps only the part with that shape.
 */
function fitExample(value: string, field: Field): string {
  const example = /(?:for example|e\.g\.?|such as)[,:]?\s*["']?([^"'.;]*\d[^"';]*?)["']?\s*$/i
    .exec(field.description)?.[1]
    ?.trim();
  if (!example) return value;
  const pattern = example
    .split(/(\p{L}+|\d+|\s+)/u)
    .filter(Boolean)
    .map((part) =>
      /^\p{L}+$/u.test(part)
        ? "\\p{L}+"
        : /^\d+$/.test(part)
          ? "\\d+"
          : /^\s+$/.test(part)
            ? "\\s+"
            : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    )
    .join("");
  const match = new RegExp(`(?<![\\p{L}\\d])${pattern}(?![\\p{L}\\d])`, "u").exec(value);
  return match && match[0] !== value ? match[0] : value;
}

/**
 * Text of `key` with the parts other fields already took removed, keeping the
 * longest remaining run of adjacent pieces (a card's address once its name and
 * phone are claimed).
 */
function residual(
  view: DataView,
  record: OutlineNode,
  key: string,
  claimedKeys: string[],
): string | undefined {
  const root = key === "." ? record : readSlot(view, record, key);
  if (!root) return undefined;
  const claimed = new Set(
    claimedKeys.map((other) => readSlot(view, record, other)?.index).filter((i) => i !== undefined),
  );
  const runs: string[][] = [[]];
  const walk = (index: number) => {
    const node = view.nodes[index]!;
    if (claimed.has(index)) {
      runs.push([]);
      return;
    }
    const kids = view.children[index] ?? [];
    if (!kids.length) {
      if (node.name.trim()) runs[runs.length - 1]!.push(node.name.trim());
      return;
    }
    for (const kid of kids) walk(kid);
  };
  walk(root.index);
  const best = runs
    .map((run) =>
      run
        .join(" ")
        .replace(/\s+([,.;:)])/g, "$1")
        .trim(),
    )
    .sort((a, b) => b.length - a.length)[0];
  return best || undefined;
}
