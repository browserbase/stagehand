import { performance } from "node:perf_hooks";
import { scoreCandidatesBm25 } from "../packages/extension/services/jevAct/bm25.js";
import {
  buildView,
  parseOutline,
  scoreCandidates,
} from "../packages/extension/services/jevAct/tree.js";

// Run with `node_modules/.bin/tsx scripts/compare-jev-rankers.ts [--jev]`.
// Generated outlines isolate ranking behavior; they are not a sample of live pages.
// --jev asks TypeSafe about both shortlists in the rare-name case.

type Case = { name: string; instruction: string; outline: string; target: string };

function rows(names: string[], button = "Delete"): string {
  const lines = ["[0-1] RootWebArea: Records", "  [0-2] table: Records"];
  let id = 3;
  for (const name of names) {
    lines.push(`    [0-${id++}] row`);
    lines.push(`      [0-${id++}] cell: ${name}`);
    lines.push(`      [0-${id++}] button: ${button}`);
  }
  return lines.join("\n");
}

const cases: Case[] = [
  {
    name: "invoice row among 80 rows",
    instruction: "Delete invoice 1042",
    outline: rows(Array.from({ length: 80 }, (_, i) => `Invoice ${1000 + i}`)),
    target: "0-131",
  },
  {
    name: "rare account name after 60 common-name rows",
    instruction: "Delete the Acme account",
    outline: rows([
      ...Array.from({ length: 60 }, (_, i) => `Account ${i + 1}`),
      "Acme",
      ...Array.from({ length: 20 }, (_, i) => `Other ${i + 1}`),
    ]),
    target: "0-185",
  },
  {
    name: "long row with target name",
    instruction: "Delete the red toaster",
    outline: rows([
      ...Array.from({ length: 55 }, (_, i) => `Red product ${i + 1}`),
      "Red toaster with an unusually long product description and details",
      ...Array.from({ length: 24 }, (_, i) => `Blue product ${i + 1}`),
    ]),
    target: "0-170",
  },
  {
    name: "semantic mismatch",
    instruction: "Erase the obsolete entry",
    outline: rows(Array.from({ length: 80 }, (_, i) => `Archive ${i + 1}`)),
    target: "0-5",
  },
];

const live = process.argv.includes("--jev");
if (live) {
  const dotenv = await import("dotenv");
  dotenv.config({ quiet: true });
}

function shortlist(scores: Map<string, number>, candidates: ReturnType<typeof buildView>) {
  return candidates
    .filter((candidate) => (scores.get(candidate.id) ?? 0) > 0)
    .sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0) || a.index - b.index)
    .slice(0, 30);
}

for (const testCase of cases) {
  const nodes = parseOutline(testCase.outline);
  const candidates = buildView(nodes, "pointer");
  const baseline = shortlist(scoreCandidates(nodes, candidates, testCase.instruction), candidates);
  const bm25 = shortlist(scoreCandidatesBm25(nodes, candidates, testCase.instruction), candidates);
  const position = (list: typeof candidates) =>
    list.findIndex((item) => item.id === testCase.target) + 1;
  const time = (score: typeof scoreCandidates) => {
    const start = performance.now();
    for (let i = 0; i < 100; i++) score(nodes, candidates, testCase.instruction);
    return (performance.now() - start) / 100;
  };
  process.stdout.write(
    `${JSON.stringify({
      case: testCase.name,
      candidates: candidates.length,
      baselineRank: position(baseline),
      bm25Rank: position(bm25),
      baselineMs: Number(time(scoreCandidates).toFixed(3)),
      bm25Ms: Number(time(scoreCandidatesBm25).toFixed(3)),
    })}\n`,
  );
  if (live && testCase.name === "rare account name after 60 common-name rows") {
    const { describeCandidate } = await import("../packages/extension/services/jevAct/tree.js");
    const { choiceAnswer, systemOne } =
      await import("../packages/extension/services/jevAct/typesafeClient.js");
    const apiKey = process.env.TYPESAFE_API_KEY;
    if (!apiKey) throw new Error("TYPESAFE_API_KEY is missing");
    for (const [ranker, list] of [
      ["baseline", baseline],
      ["bm25", bm25],
    ] as const) {
      const criteria = Object.fromEntries(
        list.map((candidate) => [candidate.id, describeCandidate(nodes, candidate)]),
      );
      const response = await systemOne(
        { apiKey },
        { instruction: testCase.instruction },
        {
          best: {
            type: "choice",
            instructions: "Which element does the instruction refer to?",
            criteria,
          },
          strict: {
            type: "choice",
            instructions: "Which element does the instruction refer to?",
            criteria: { ...criteria, none_match: "None of these elements matches the instruction" },
          },
        },
      );
      process.stdout.write(
        `${JSON.stringify({
          ranker,
          jevChoice: choiceAnswer(response, "best").choice,
          jevConfidence: choiceAnswer(response, "best").confidence,
          jevNone: choiceAnswer(response, "strict").probabilities.none_match,
          jevMs: response.durationMs,
          inputTokens: response.usage.inputTokens,
        })}\n`,
      );
    }
  }
}
