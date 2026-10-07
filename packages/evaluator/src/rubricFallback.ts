/**
 * Deterministic detection of rubric fallback clauses (owner ruling 2026-09-06: a disclosed fallback
 * passes when the RUBRIC's own clause allows it). Rubric authors write these as "Full credit if/also if
 * <unavailable | out of stock | inaccessible | blocked | no exact match> ... and the agent reports/
 * discloses ...". Surfacing them explicitly stops the judge from marking such rows "unachievable"
 * without considering the clause.
 */
import type { Rubric } from "./types.js";

const FALLBACK_RE =
  /((?:full|partial)\s+credit\s+(?:also\s+)?(?:if|when)[^.]*?(?:unavailab|not\s+available|out\s+of\s+stock|inaccessib|blocked|block|captcha|login\s+wall|no\s+(?:exact\s+)?match|impossible|cannot\s+be|technical\s+error|site\s+error|closest\s+(?:available\s+)?alternative|report(?:s|ed|ing)?\s+the\s+(?:blocker|issue|unavailab))[^.]*\.)/gi;

export interface FallbackClause {
  criterion: string;
  clause: string;
}

export function detectRubricFallbacks(rubric: Rubric | undefined): FallbackClause[] {
  const out: FallbackClause[] = [];
  for (const item of rubric?.items ?? []) {
    // Normalize abbreviations so "e.g." / "i.e." do not terminate the clause sentence.
    const text = `${item.criterion}. ${item.description ?? ""}`
      .replace(/\be\.g\./gi, "eg")
      .replace(/\bi\.e\./gi, "ie")
      .replace(/\betc\./gi, "etc");
    for (const m of text.matchAll(FALLBACK_RE)) {
      out.push({ criterion: item.criterion, clause: m[1].replace(/\s+/g, " ").trim() });
    }
  }
  return out;
}

/** Block appended to the rubric section of judge prompts. Empty when the rubric has no fallback clause. */
export function describeRubricFallbacks(rubric: Rubric | undefined): string {
  const clauses = detectRubricFallbacks(rubric);
  if (!clauses.length) return "";
  const lines = clauses.map((c) => `- [${c.criterion}] ${c.clause}`);
  return `\n\n**Rubric fallback clauses present (deterministic scan).** If the recorded observations show the condition in a clause below and the final answer discloses it, the clause governs that requirement: emit goal_achievability.state = unachievable_fallback_accepted and do not mark that requirement contradicted. Every constraint the clause does not cover still binds.\n${lines.join("\n")}`;
}
