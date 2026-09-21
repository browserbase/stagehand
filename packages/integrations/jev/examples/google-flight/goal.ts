/**
 * Jev cannot generate text. Anything the agent types therefore has to be
 * lifted from the goal, and Jev's part is only to choose which of those spans
 * belongs in the field it is filling.
 *
 * This is the same constraint the act pipeline enforces with
 * `packages/extension/services/jevAct/args.ts`, applied to a whole goal instead
 * of a single instruction.
 */

const MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

const MONTH_NAMES = Object.keys(MONTHS).join("|");
/** "September 28, 2026" / "28 September 2026" / "2026-09-28". */
const DATE_PATTERNS = [
  new RegExp(`\\b(${MONTH_NAMES})\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, "gi"),
  new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_NAMES}),?\\s+(\\d{4})\\b`, "gi"),
  /\b(\d{4})-(\d{2})-(\d{2})\b/g,
];

/** Words that open a sentence without naming anything. */
const SENTENCE_OPENERS = new Set([
  "find",
  "search",
  "go",
  "open",
  "click",
  "type",
  "stop",
  "do",
  "then",
  "the",
  "a",
  "an",
  "when",
  "if",
  "book",
  "select",
]);

const QUOTED = /(?<![\w])'([^'\n]+)'(?![\w])|"([^"\n]+)"|“([^”\n]+)”|‘([^’\n]+)’/g;
/** A run of capitalised words, optionally carrying digits ("New York", "Terminal 2"). */
const PROPER_NOUN = /\b[A-Z][\p{L}'’-]*(?:\s+(?:[A-Z][\p{L}'’-]*|\d{1,4}))*/gu;

function iso(year: number, month: number, day: number): string | undefined {
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Every date in the goal, normalised to ISO. Only ISO: offering "2026-09-28"
 * and "September 28, 2026" side by side splits the choice between two spellings
 * of one answer, and the prose one is the spelling a date input is least likely
 * to parse — Google Flights silently rejects it and reopens its calendar. The
 * spans come back too, so the proper-noun pass does not re-read "September 28"
 * as a place.
 */
function dates(goal: string): { values: string[]; spans: string[] } {
  const values: string[] = [];
  const spans: string[] = [];
  for (const pattern of DATE_PATTERNS) {
    for (const match of goal.matchAll(pattern)) {
      const [span, first, second, third] = match as unknown as [string, string, string, string];
      const normalized = /^\d{4}$/.test(first)
        ? iso(Number(first), Number(second), Number(third))
        : first.toLowerCase() in MONTHS
          ? iso(Number(third), MONTHS[first.toLowerCase()]!, Number(second))
          : iso(Number(third), MONTHS[second.toLowerCase()]!, Number(first));
      if (!normalized) continue;
      spans.push(span);
      values.push(normalized);
    }
  }
  return { values, spans };
}

/**
 * The closed set of strings the agent is allowed to type, in the goal's own
 * characters: quoted spans, dates (ISO and as written), and proper nouns.
 */
export function fillCandidates(goal: string): string[] {
  const values: string[] = [];
  for (const match of goal.matchAll(QUOTED)) {
    values.push((match[1] ?? match[2] ?? match[3] ?? match[4])!);
  }

  const { values: dateValues, spans } = dates(goal);
  values.push(...dateValues);

  // Blank out the date spans so "September 28" is not also offered as a place.
  let remaining = goal;
  for (const span of spans) remaining = remaining.split(span).join(" ".repeat(span.length));

  for (const match of remaining.matchAll(PROPER_NOUN)) {
    const words = match[0].trim().split(/\s+/);
    // A capitalised verb at the start of a sentence names nothing; drop it and
    // keep whatever followed it ("Find one-way flights from Zurich" → "Zurich").
    while (words.length > 0 && SENTENCE_OPENERS.has(words[0]!.toLowerCase())) words.shift();
    const value = words.join(" ");
    if (value.length > 1) values.push(value);
  }

  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
