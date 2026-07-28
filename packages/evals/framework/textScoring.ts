/**
 * Shared text-scoring helpers for bench-v4 tasks.
 *
 * Behavior-identical copies of `normalizeString`/`compareStrings` from
 * stagehand packages/evals/utils.ts and the `jaroWinkler` similarity from
 * string-comparison@1.3.0 — bench-v4 tasks cannot import utils.ts directly,
 * so the implementations live here (previously inlined per-task). Pure
 * computation, no behavior change.
 */
export function normalizeString(str: string): string {
  return str
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[;/#!$%^&*:{}=\-_`~()]/g, "")
    .replace(/\s*,\s*/g, ", ")
    .trim();
}

function jaroSimilarity(first: string, second: string): number {
  // string-comparison initParams: strip all whitespace + lowercase
  const s1 = first.replace(/\s+/g, "").toLowerCase();
  const s2 = second.replace(/\s+/g, "").toLowerCase();
  if (!s1.length && !s2.length) return 1;
  if (!s1.length || !s2.length) return 0;
  if (s1 === s2) return 1;
  const len1 = s1.length;
  const len2 = s2.length;
  if (len1 === 0 || len2 === 0) return 0;
  const matchWindow = Math.floor(Math.max(len1, len2) / 2) - 1;
  let matches = 0;
  const s1Matches = new Array(s1.length).fill(0);
  const s2Matches = new Array(s2.length).fill(0);
  for (let i = 0; i < len1; i++) {
    for (let j = Math.max(0, i - matchWindow); j < Math.min(len2, i + matchWindow + 1); j++) {
      if (s1[i] === s2[j] && s2Matches[j] === 0) {
        s1Matches[i] = 1;
        s2Matches[j] = 1;
        matches++;
        break;
      }
    }
  }
  if (matches === 0) return 0;
  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < len1; i++) {
    if (s1Matches[i] === 1) {
      while (s2Matches[k] === 0) k++;
      if (s1[i] !== s2[k++]) transpositions++;
    }
  }
  transpositions /= 2;
  return (matches / len1 + matches / len2 + (matches - transpositions) / matches) / 3;
}

function jaroWinklerSimilarity(a: string, b: string): number {
  let sim = jaroSimilarity(a, b);
  if (sim > 0.7) {
    // NOTE: string-comparison computes the common prefix on the raw inputs
    // (pre-initParams), preserved here.
    let prefix = 0;
    for (let i = 0; i < Math.min(a.length, b.length) && a[i] === b[i]; i++) {
      prefix++;
    }
    prefix = Math.min(4, prefix);
    sim += 0.1 * prefix * (1 - sim);
  }
  return sim;
}

export function compareStrings(
  actual: string,
  expected: string,
  similarityThreshold: number = 0.85,
): { similarity: number; meetsThreshold: boolean } {
  const similarity = jaroWinklerSimilarity(normalizeString(actual), normalizeString(expected));
  return {
    similarity,
    meetsThreshold: similarity >= similarityThreshold,
  };
}
