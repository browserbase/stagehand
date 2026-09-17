import { describeCandidate, flattenText, tokens, type OutlineNode } from "./tree.js";
import type { JsonValue } from "./typesafeClient.js";

/** BM25 with the current ranker's name, text, and table weights retained. */
export function scoreCandidatesBm25(
  nodes: OutlineNode[],
  candidates: OutlineNode[],
  instruction: string,
): Map<string, number> {
  const query = new Set(tokens(instruction));
  const documents = candidates.map((candidate) => {
    const description = describeCandidate(nodes, candidate);
    const fields: Array<[JsonValue | undefined, number]> = [
      [description.name, 3],
      [description.text, 2],
      [description.within, 1],
      [description.under_heading, 1],
      [description.near_text, 1],
      [description.group_text, 1],
      [description.table, 2],
    ];
    const frequencies = new Map<string, number>();
    let length = 0;
    for (const [value, weight] of fields) {
      for (const word of tokens(value === undefined ? "" : flattenText(value))) {
        length += weight;
        if (query.has(word)) frequencies.set(word, (frequencies.get(word) ?? 0) + weight);
      }
    }
    return { id: candidate.id, frequencies, length };
  });
  const averageLength =
    documents.reduce((sum, document) => sum + document.length, 0) / (documents.length || 1) || 1;
  const documentFrequency = new Map<string, number>();
  for (const document of documents) {
    for (const word of document.frequencies.keys())
      documentFrequency.set(word, (documentFrequency.get(word) ?? 0) + 1);
  }
  const scores = new Map<string, number>();
  const n = documents.length;
  for (const document of documents) {
    let score = 0;
    for (const [word, frequency] of document.frequencies) {
      const df = documentFrequency.get(word)!;
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
      const denominator = frequency + 1.2 * (0.65 + 0.35 * (document.length / averageLength));
      score += idf * ((frequency * 2.2) / denominator);
    }
    scores.set(document.id, score);
  }
  return scores;
}
