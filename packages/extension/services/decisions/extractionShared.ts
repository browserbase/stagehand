import { type DecisionModelConfig, decide, type DecisionQuestion } from "./client.js";
import { type DataView, type Slot, clip, type Fact } from "./dataView.js";
import { type OutlineNode } from "./outline.js";
import { type Field, fieldText } from "./extractionSchema.js";

export type TraceEntry = {
  step: string;
  choice: string;
  confidence: number;
  options: number;
  sourceIds?: string[];
  recordId?: string;
};

/**
 * A span or field extractor (Perplexity Decider locate, Cloudflare Clairic)
 * that reads single values from a small fact sheet the data view prepares.
 */
export type ScalarReaderInput = {
  sheet: string;
  fields: { name: string; type: "string" | "number"; instructions: string }[];
};

export type ScalarReader = (
  input: ScalarReaderInput,
) => Promise<Record<string, string | number | null | undefined>>;

export const NONE = "none";

export async function ask(
  config: DecisionModelConfig,
  state: Parameters<typeof decide>[1],
  questions: Record<string, DecisionQuestion>,
) {
  return decide(config, state, questions);
}

const STOP = new Set(
  "the a an of and or to in on for with by from at as is are be this that these those all each every any extract find get list their its it his her them they which what who whose do not include".split(
    " ",
  ),
);

export function tokens(text: string): Set<string> {
  return new Set(
    Array.from(text.toLowerCase().matchAll(/[\p{L}\d]+/gu), (match) => match[0])
      .filter((token) => !STOP.has(token) && (token.length > 1 || /\d/.test(token)))
      .map((token) => token.replace(/(ing|ed|es|s)$/, "") || token),
  );
}

export const overlap = (a: Set<string>, b: Set<string>) =>
  [...a].filter((token) => b.has(token)).length;

export function choiceOf(
  answers: Record<string, unknown>,
  key: string,
  trace: TraceEntry[],
  step: string,
  options: number,
): { choice: string; confidence: number } {
  const answer = answers[key] as { type: string; choice?: string; confidence?: number } | undefined;
  const choice = answer?.type === "choice" ? (answer.choice ?? NONE) : NONE;
  const confidence = answer?.confidence ?? 0;
  trace.push({ step, choice, confidence, options });
  return { choice, confidence };
}

/** A reason to hand the page to the fallback model, collected by the verdict. */
export function problem(trace: TraceEntry[], reason: string) {
  trace.push({ step: "problem", choice: reason, confidence: 0, options: 0 });
}

export function noulOf(answers: Record<string, unknown>, key: string): number {
  const answer = answers[key] as { type: string; noul?: number } | undefined;
  return answer?.type === "noul" ? (answer.noul ?? 0) : 0;
}

const WORD_NUMBERS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

/**
 * The numbers the instruction itself mentions ("the 5 tallest", "first ten"),
 * offered to the model as possible item counts. Which one (if any) is a count
 * is the model's call, not a phrase pattern's.
 */
export function countOptions(instruction: string): number[] {
  const numbers = (
    instruction.match(/\b(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten)\b/gi) ?? []
  ).map((token) => WORD_NUMBERS[token.toLowerCase()] ?? Number(token));
  return [...new Set(numbers)].filter((n) => n >= 1 && n <= 500);
}

/** Every number in `text` with a little context, for the model to choose from. */
export function numberCandidates(text: string): { value: number; shown: string }[] {
  return [...text.matchAll(NUMBER)].flatMap((match) => {
    const value = parseNumber(match[0], new Set());
    if (value === undefined) return [];
    const at = match.index!;
    const shown = `…${text.slice(Math.max(0, at - 40), at)}[${match[0]}]${text.slice(at + match[0].length, at + match[0].length + 25)}…`;
    return [{ value, shown: shown.replace(/\s+/g, " ") }];
  });
}

const NUMBER =
  /(?<![\p{L}\d.])[-+]?\$?(?:\d[\d,]*(?:\.\d+)?|\.\d+)(?:e[-+]?\d+)?(?![\d.,]\d)(?:(k|m|bn?)|\s?(thousand|million|billion))?(?!-?\p{L})/giu;

const UNITS: Record<string, number> = {
  k: 1e3,
  thousand: 1e3,
  m: 1e6,
  million: 1e6,
  b: 1e9,
  bn: 1e9,
  billion: 1e9,
};

export function parseNumber(text: string, hint: Set<string>): number | undefined {
  const matches = [...text.matchAll(NUMBER)];
  if (matches.length === 0) {
    const word = Object.keys(WORD_NUMBERS).find((w) => new RegExp(`\\b${w}\\b`, "i").test(text));
    return word ? WORD_NUMBERS[word] : undefined;
  }
  // Each hint word pulls toward the numbers right after it; rare words ("15")
  // pull harder than words every candidate shares ("inch").
  const words = [...text.matchAll(/[\p{L}\d]+/gu)].map((m) => ({
    token: tokens(m[0]),
    at: m.index!,
  }));
  const pulls = words.flatMap(({ token, at }) =>
    [...token].filter((t) => hint.has(t)).map((t) => ({ t, at })),
  );
  const frequency = new Map<string, number>();
  for (const { t } of pulls) frequency.set(t, (frequency.get(t) ?? 0) + 1);
  let best = matches[0]!;
  let bestScore = -Infinity;
  for (const match of matches) {
    const at = match.index!;
    let score = match[0].includes("$") ? 0.2 : 0;
    for (const { t, at: where } of pulls) {
      if (where >= at && where < at + match[0].length) continue;
      const distance = where < at ? at - where : (where - at) * 3;
      score += Math.exp(-distance / 40) / frequency.get(t)!;
    }
    if (score > bestScore) [best, bestScore] = [match, score];
  }
  const unit = (best[1] ?? best[2])?.toLowerCase();
  const value = Number(best[0].replace(/[$,+]|\s?[a-z]+$/gi, "")) * (unit ? UNITS[unit]! : 1);
  return Number.isFinite(value) ? value : undefined;
}

function urlFor(view: DataView, node: OutlineNode): string | undefined {
  if (view.urlMap[node.id]) return view.urlMap[node.id];
  for (let i = node.index + 1; i < view.nodes.length && view.nodes[i]!.depth > node.depth; i++) {
    const url = view.urlMap[view.nodes[i]!.id];
    if (url) return url;
  }
  let current = node.parent === undefined ? undefined : view.nodes[node.parent];
  for (let hops = 0; current && hops < 3; hops++) {
    if (view.urlMap[current.id]) return view.urlMap[current.id];
    current = current.parent === undefined ? undefined : view.nodes[current.parent];
  }
  return undefined;
}

export function convert(
  view: DataView,
  node: OutlineNode | undefined,
  field: Field,
  fromList = false,
): string | number | undefined {
  if (!node) return undefined;
  if (field.type === "url") return urlFor(view, node);
  if (field.type === "number" || field.type === "integer")
    return parseNumber(node.name, tokens(fieldText(field)));
  return stripLabel(node.name.replace(/\s+/g, " ").trim(), field, fromList);
}

export function rankSlots(slots: Slot[], field: Field): Slot[] {
  const wanted = tokens(fieldText(field));
  return slots
    .filter((slot) => (field.type === "url" ? slot.link : true))
    .map((slot) => ({
      slot,
      score:
        slot.coverage +
        overlap(wanted, tokens(`${slot.label ?? ""} ${slot.samples.join(" ")}`)) * 0.5,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 24)
    .map(({ slot }) => slot);
}

export function describeSlot(slot: Slot, field?: Field): string {
  const samples = (field?.type === "url" ? slot.urlSamples : slot.samples)
    .map((sample) => `"${clip(sample, 90)}"`)
    .join(" | ");
  const sparse =
    slot.coverage < 0.5 ? ` (present on ${Math.round(slot.coverage * 100)}% of items)` : "";
  return `${slot.label ? `column "${slot.label}", ` : ""}e.g. ${samples}${sparse}`;
}

function stripLabel(text: string, field: Field, fromList = false): string {
  // An unspaced colon in a list value can be part of an identifier.
  const prefix = fromList ? /^([^:]{1,40}):\s+(.+)$/s : /^([^:]{1,40}):\s*(.+)$/s;
  const match = prefix.exec(text);
  if (!match) return text;
  const label = match[1]!.trim();
  if (overlap(tokens(label), tokens(fieldText(field))) > 0) return match[2]!.trim();
  return text;
}

export function valueFromFact(fact: Fact, field: Field) {
  return field.type === "url"
    ? fact.url
    : field.type === "string"
      ? stripLabel(fact.value.replace(/\s+/g, " ").trim(), field)
      : parseNumber(fact.value, tokens(fieldText(field)));
}
