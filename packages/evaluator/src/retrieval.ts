import { createHash } from "node:crypto";
import type { CanonicalEvidence, CanonicalTextEvidence, Rubric } from "./types.js";

const STOP = new Set(
  "the and with from that this for have into then when which what your their page task report find show information please".split(
    " ",
  ),
);
function terms(text: string): Set<string> {
  // Keep complete model/part identifiers, but also index words encoded in URL
  // slugs and filenames (e.g. "1-Year-Limited-Warranty.pdf").
  const tokens = text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}._-]*/gu) ?? [];
  return new Set(
    tokens.flatMap((t) => [t, ...t.split(/[._-]+/)]).filter((t) => t.length > 2 && !STOP.has(t)),
  );
}

export function imageKey(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export interface AnswerAnchor {
  /** Normalized phrase or value claimed in the final answer. */
  phrase: string;
  kind: "quote" | "money" | "identifier";
  /** Canonical indices of observation chunks containing the phrase (empty = found nowhere). */
  found: number[];
  steps: number[];
}

const QUOTE_RE = /[“"„]([^”"„]{8,200})[”"]|[‘']([^’']{12,200})[’']/g;
// Lookahead only rejects a continuing number (digit, or separator followed by a digit), so trailing
// punctuation like "$99.99." or "$1200.00," still yields the full amount.
const MONEY_RE = /[$€£]\s?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,4})?(?!\d|[,.]\d)/g;
const IDENT_RE =
  /\b(?=[A-Za-z0-9-]*\d)(?=[A-Za-z0-9-]*[A-Za-z])[A-Z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*\b/g;

/** Normalize for exact-ish matching: quotes, dashes, whitespace, NBSP, case. */
export function normalizeForMatch(text: string): string {
  return text
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Exact claims in the final answer that recorded observations can confirm or refute:
 * quoted phrases, money values, and alphanumeric identifiers (SKUs, model codes, route ids).
 */
export function extractAnchors(
  answer: string,
): Array<{ phrase: string; kind: AnswerAnchor["kind"] }> {
  const out = new Map<string, AnswerAnchor["kind"]>();
  for (const m of answer.matchAll(QUOTE_RE)) {
    const q = normalizeForMatch(m[1] ?? m[2] ?? "");
    if (q.length >= 8 && /[a-z]/.test(q)) out.set(q, "quote");
  }
  for (const m of answer.matchAll(MONEY_RE))
    out.set(normalizeForMatch(m[0]).replace(/\s/g, ""), "money");
  for (const m of answer.matchAll(IDENT_RE)) {
    const id = normalizeForMatch(m[0]);
    if (id.length >= 4 && id.length <= 24) out.set(id, "identifier");
  }
  return [...out].slice(0, 40).map(([phrase, kind]) => ({ phrase, kind }));
}

const OBSERVATION_SOURCES = new Set(["probe-aria", "tool-output", "screenshot-ocr"]);

function containsAnchor(
  normalizedContent: string,
  anchor: { phrase: string; kind: AnswerAnchor["kind"] },
): boolean {
  if (anchor.kind === "money") return normalizedContent.replace(/\s/g, "").includes(anchor.phrase);
  return normalizedContent.includes(anchor.phrase);
}

/** Overlap preserves values next to labels, including inside one-line JSON batches. */
export function chunkText(
  text: string,
  size = 2000,
  overlap = 250,
): Array<{ content: string; start: number; end: number }> {
  if (size <= overlap || overlap < 0) throw new Error("Invalid chunk bounds");
  const chunks = [];
  for (let start = 0; start < text.length; ) {
    let end = Math.min(text.length, start + size);
    const newline = text.lastIndexOf("\n", end);
    if (end < text.length && newline > start + size / 2) end = newline + 1;
    chunks.push({ content: text.slice(start, end), start, end });
    if (end === text.length) break;
    start = end - overlap;
  }
  return chunks;
}

/** Pseudo-criterion key for evidence selected because it contains a claimed exact value/quote. */
export const ANCHOR_GROUP = -1;
/** Pseudo-criterion key for screenshots attached by recency (imageSelection "recency"). */
export const RECENT_IMAGE_GROUP = -2;

export interface Retrieval {
  groups: Map<number, number[]>;
  /** Exact claims from the final answer located (or not) in recorded observations. */
  anchors: AnswerAnchor[];
  selected: CanonicalTextEvidence[];
  totalChunks: number;
  selectedChars: number;
  omittedChunks: number;
}

/** Criterion-first retrieval scans every chunk. Answer overlap only breaks ties. */
export function retrieveText(
  evidence: CanonicalEvidence[],
  rubric: Rubric,
  answer: string,
  tokenBudget: number,
): Retrieval {
  const texts = evidence.filter((e): e is CanonicalTextEvidence => "content" in e);
  const tokenSets = new Map(texts.map((e) => [e.canonicalIndex, terms(e.content)]));
  const answerTerms = terms(answer);
  const df = new Map<string, number>();
  for (const set of tokenSets.values())
    for (const term of set) df.set(term, (df.get(term) ?? 0) + 1);
  const lists = rubric.items.map((criterion) => {
    const query = terms(`${criterion.criterion} ${criterion.description}`);
    return texts
      .map((e) => {
        const tokens = tokenSets.get(e.canonicalIndex)!;
        let score = 0;
        for (const term of query)
          if (tokens.has(term)) score += Math.log(1 + texts.length / (df.get(term) ?? 1));
        // Answer agreement must not exclude a contradictory value attached to the same label.
        const tie = [...answerTerms].filter((t) => tokens.has(t)).length;
        return { e, score, tie };
      })
      .sort(
        (a, b) =>
          b.score - a.score ||
          b.e.originalStepIndex - a.e.originalStepIndex ||
          b.tie - a.tie ||
          a.e.canonicalIndex - b.e.canonicalIndex,
      );
  });
  const selected = new Map<number, CanonicalTextEvidence>();
  const groups = new Map<number, number[]>();
  let chars = 0;
  const budget = Math.max(0, tokenBudget * 4);
  const add = (e: CanonicalTextEvidence, criterion: number) => {
    const cost = e.content.length + 160;
    if (!selected.has(e.canonicalIndex) && chars + cost > budget) return false;
    if (!selected.has(e.canonicalIndex)) {
      selected.set(e.canonicalIndex, e);
      chars += cost;
    }
    const group = groups.get(criterion) ?? [];
    if (!group.includes(e.canonicalIndex)) group.push(e.canonicalIndex);
    groups.set(criterion, group);
    return true;
  };
  // Answer anchors: exact quotes/values the agent claimed. Scan EVERY observation chunk (never
  // agent text or action arguments, which would let a claim confirm itself) and force-include the
  // chunk holding each located claim so the judge can verify it; report unlocated claims.
  const anchors: AnswerAnchor[] = [];
  const normalized = new Map(
    texts
      .filter((e) => OBSERVATION_SOURCES.has(e.source))
      .map((e) => [e.canonicalIndex, normalizeForMatch(e.content)]),
  );
  const anchorBudget = budget * 0.35;
  let anchorChars = 0;
  for (const a of extractAnchors(answer)) {
    const hits = texts.filter(
      (e) =>
        normalized.has(e.canonicalIndex) && containsAnchor(normalized.get(e.canonicalIndex)!, a),
    );
    const anchor: AnswerAnchor = {
      phrase: a.phrase,
      kind: a.kind,
      found: hits.map((e) => e.canonicalIndex),
      steps: [...new Set(hits.map((e) => e.originalStepIndex))].sort((x, y) => x - y),
    };
    anchors.push(anchor);
    // Include the latest-step hit first (later recorded state governs), then the earliest.
    const ordered = [...hits].sort(
      (x, y) => y.originalStepIndex - x.originalStepIndex || x.canonicalIndex - y.canonicalIndex,
    );
    for (const e of [ordered[0], ordered[ordered.length - 1]].filter(Boolean)) {
      if (selected.has(e.canonicalIndex)) {
        add(e, ANCHOR_GROUP);
        continue;
      }
      // Always allow the first located claim in; afterwards respect the anchor share of the budget.
      if (anchorChars > 0 && anchorChars + e.content.length + 160 > anchorBudget) break;
      if (add(e, ANCHOR_GROUP)) anchorChars += e.content.length + 160;
    }
  }
  // Preserve action arguments that compact history hides (e.g. batched form fills).
  // They establish attempts/side effects, not independent proof of reported facts.
  const actions = texts
    .filter((e) => e.source === "action")
    .sort((a, b) => {
      const mutation = (e: CanonicalTextEvidence) =>
        /fill|type|submit|checkout|remove|delete|purchase/i.test(e.content) ? 1 : 0;
      return (
        mutation(b) - mutation(a) ||
        a.originalStepIndex - b.originalStepIndex ||
        a.canonicalIndex - b.canonicalIndex
      );
    });
  for (const action of actions) {
    if (chars + action.content.length + 160 > budget / 4) continue;
    if (lists.length) add(action, 0);
  }
  // Round-robin prevents the first criterion from consuming the whole budget.
  for (let rank = 0; rank < 12; rank++)
    for (let i = 0; i < lists.length; i++) {
      const candidate = lists[i][rank];
      if (candidate) add(candidate.e, i);
    }
  // Keep time-distributed context, including late reversals and earlier conflicting states.
  if (texts.length && lists.length)
    for (let i = 0; i < 12; i++) {
      add(texts[Math.round((i * (texts.length - 1)) / 11)], i % lists.length);
    }
  const ordered = [...selected.values()].sort(
    (a, b) => a.originalStepIndex - b.originalStepIndex || a.canonicalIndex - b.canonicalIndex,
  );
  return {
    groups,
    anchors,
    selected: ordered,
    totalChunks: texts.length,
    selectedChars: chars,
    omittedChunks: texts.length - ordered.length,
  };
}

export function renderAnchorReport(anchors: AnswerAnchor[]): string {
  if (!anchors.length) return "";
  const located = anchors.filter((a) => a.found.length);
  const missing = anchors.filter((a) => !a.found.length);
  const fmt = (a: AnswerAnchor) => (a.kind === "quote" ? `"${a.phrase}"` : a.phrase);
  const lines = [
    "**Answer anchors** (exact quotes/values claimed in the final answer, scanned against ALL recorded page text and tool output, never against agent text):",
  ];
  if (located.length)
    lines.push(
      ...located.map(
        (a) =>
          `- located: ${fmt(a)} → step ${a.steps.join(", ")} (evidence ${a.found.map((i) => `#${i}`).join(", ")})`,
      ),
    );
  if (missing.length)
    lines.push(
      ...missing.map((a) => `- NOT FOUND in any recorded observation: ${fmt(a)}`),
      "These were not found in recorded page text (or screenshot text, when OCR is enabled); check the attached screenshots before treating a value as unsupported. Absence alone is not a contradiction.",
    );
  return lines.join("\n");
}

export function renderRetrievedEvidence(
  evidence: CanonicalEvidence[],
  groups: Map<number, number[]>,
  anchors: AnswerAnchor[] = [],
): string {
  const ids = new Set([...groups.values()].flat());
  const references = [...groups]
    .map(
      ([criterion, indices]) =>
        `${criterion === ANCHOR_GROUP ? "Answer-anchor evidence" : criterion === RECENT_IMAGE_GROUP ? "Selected screenshots" : `Criterion ${criterion}`}: ${indices.map((i) => `#${i}`).join(", ")}`,
    )
    .join("\n");
  const anchorReport = renderAnchorReport(anchors);
  const body = evidence
    .filter((e) => ids.has(e.canonicalIndex))
    .map((e) =>
      "content" in e
        ? `Evidence #${e.canonicalIndex} | step=${e.originalStepIndex} | ${e.source} | offsets=${e.startOffset ?? 0}:${e.endOffset ?? e.content.length}\n${e.content}`
        : `Evidence #${e.canonicalIndex} | screenshot | step=${e.originalStepIndex}`,
    )
    .join("\n\n");
  return `${references}${anchorReport ? `\n\n${anchorReport}` : ""}\n\n${body}`;
}
