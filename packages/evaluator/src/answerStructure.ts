/**
 * Deterministic classification of a final answer's structure, used to apply the owner's table
 * ruling (2026-09-05) mechanically: any consistent delimited structure (markdown/HTML table,
 * multi-line pipe rows, CSV-like rows, or delimited records with the same fields per record)
 * satisfies a generic "table" requirement; prose with no column structure does not.
 * Mirrors packages/evals/scripts/audit/label-overlay.py. URLs are masked before counting
 * delimiters so "https://…" colons and commas inside links never count as columns.
 */
export type AnswerStructure =
  | "markdown-table"
  | "html-table"
  | "json-records"
  | "multiline-pipe-rows"
  | "csv-rows"
  | "inline-delimited"
  | "prose"
  | "empty";

const URL_RE = /https?:\/\/\S+/g;

export function unwrapAnswer(answer: string | undefined): string {
  const a = (answer ?? "").trim();
  const m = a.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/) ?? a.match(/^(\{[\s\S]*\})$/);
  if (m) {
    try {
      const obj = JSON.parse(m[1]) as Record<string, unknown>;
      const inner = obj.finalAnswer ?? obj.answer ?? obj.result;
      if (typeof inner === "string" && inner.trim()) return inner;
    } catch {
      /* not JSON */
    }
  }
  return a;
}

const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;
const consistent = (ns: number[], tol = 1) =>
  ns.length > 0 && Math.max(...ns) - Math.min(...ns) <= tol;

export function answerStructure(answer: string | undefined): AnswerStructure {
  const raw = unwrapAnswer(answer);
  if (!raw.trim()) return "empty";
  if (isStructuredJson(raw)) return "json-records";
  const a = raw.replace(URL_RE, "URL");
  const lines = a.split("\n").filter((l) => l.trim());
  if (/<table[\s>]/i.test(a) && /<tr[\s>]/i.test(a)) return "html-table";
  if (/^\s*\|?[\s:-]+\|[\s:|-]+$/m.test(a)) return "markdown-table";
  const pipeLines = lines.filter((l) => count(l, /\|/g) >= 1);
  if (pipeLines.length >= 2 && consistent(pipeLines.map((l) => count(l, /\|/g))))
    return "multiline-pipe-rows";
  // CSV-like: 3+ short lines with the same number of commas (header + rows), not sentences.
  const commaLines = lines.filter(
    (l) => count(l, /,/g) >= 1 && l.length <= 240 && !/[.!?]\s*$/.test(l.trim()),
  );
  if (
    lines.length >= 3 &&
    commaLines.length === lines.length &&
    consistent(
      commaLines.map((l) => count(l, /,/g)),
      0,
    )
  )
    return "csv-rows";
  if (lines.length <= 2 && count(a, /\|/g) >= 4) return "inline-delimited";
  if (lines.length <= 2 && count(a, /;/g) >= 1) {
    // Records separated by ";", each with the same number of field delimiters (":", ",", " = ").
    // Owner ruling (2026-09-06, shape B): one record per ";" with a regular core ("item price = unit")
    // counts as a table even when records carry uneven parenthetical extras.
    const recs = a
      .replace(/\([^)]*\)/g, "")
      .split(";")
      .map((r) => r.trim())
      .filter(Boolean);
    const fields = recs.map((r) =>
      Math.max(count(r, /:/g), count(r, /,/g), count(r, / = /g), count(r, /\$\d/g)),
    );
    if (recs.length >= 2 && Math.min(...fields) >= 1 && consistent(fields, 1))
      return "inline-delimited";
  }
  return "prose";
}

/**
 * A JSON deliverable counts as structured records when it contains an array of ≥2 objects sharing ≥2
 * keys, or an object with ≥3 scalar fields (a field/value table). Graders accept both as a table.
 */
/** The leading balanced JSON object/array of a string (agents sometimes append text after it). */
function leadingJson(text: string): string | undefined {
  if (!text.startsWith("{") && !text.startsWith("[")) return undefined;
  let depth = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) return text.slice(0, i + 1);
    }
  }
  return undefined;
}

function isStructuredJson(text: string): boolean {
  const leading = leadingJson(text.trim());
  if (leading === undefined) return false;
  let value: unknown;
  try {
    value = JSON.parse(leading);
  } catch {
    return false;
  }
  const seen: unknown[] = [value];
  for (let depth = 0; depth < 3 && seen.length; depth++) {
    const next: unknown[] = [];
    for (const v of seen) {
      if (Array.isArray(v)) {
        const objs = v.filter(
          (x): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x),
        );
        if (objs.length >= 2) {
          const shared = Object.keys(objs[0]).filter((k) => objs.every((o) => k in o));
          if (shared.length >= 2) return true;
        }
        next.push(...v);
      } else if (v && typeof v === "object") {
        const entries = Object.values(v as Record<string, unknown>);
        if (
          depth === 0 &&
          entries.filter((x) => x === null || ["string", "number", "boolean"].includes(typeof x))
            .length >= 3
        )
          return true;
        next.push(...entries);
      }
    }
    seen.splice(0, seen.length, ...next);
  }
  return false;
}

export function satisfiesTable(s: AnswerStructure): boolean {
  return s !== "prose" && s !== "empty";
}

/** Text appended under the final answer in judge prompts so the table rule is applied mechanically. */
export function describeAnswerStructure(answer: string | undefined): string {
  const s = answerStructure(answer);
  return `[Answer structure (deterministic): ${s}. Policy: this classification is authoritative ONLY for whether a generic "table" requirement is met — ${
    satisfiesTable(s)
      ? "it SATISFIES the table requirement even if serialized on one line"
      : "it does NOT satisfy a table requirement"
  }. It says nothing about which columns, rows, fields or values are present; check those on their own merits.]`;
}

/** True when any rubric criterion requires a table deliverable (mirrors rubric-clarify.py / v12-relabel.py). */
const CONVENTION_MARKER =
  /\s(?:Format|Fallback|Critical-point|Source|Date|Deliverable) convention:/;

/**
 * True when a rubric criterion itself requires a table deliverable. Appended v1.2 convention sentences
 * are ignored ("…another company's comparison table is not an authoritative source…" is not a table
 * requirement); they always follow the original criterion text.
 */
export function rubricRequiresTable(
  rubric: { items?: Array<{ criterion?: string; description?: string }> } | undefined,
): boolean {
  return (rubric?.items ?? []).some((it) => {
    const original = (it.description ?? "").split(CONVENTION_MARKER)[0];
    return /\btable\b|tabular/i.test(`${it.criterion ?? ""} ${original}`);
  });
}
