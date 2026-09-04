/**
 * Scripted agent trajectories for the welcome flows.
 *
 * Every case is a REAL WebVoyager benchmark task (id + site + question come
 * from datasets/webvoyager/WebVoyager_data.jsonl, re-read at runtime when
 * present). The steps are a hand-written, deterministic replay of how an
 * agent solves it — observe → act → extract → answer → judge — so onboarding
 * can show what an agent run looks like without a key, a browser, or a bill.
 * Timings and costs are illustrative and labelled as such by the callers.
 */

import fs from "node:fs";
import path from "node:path";
import { getPackageRootDir } from "../../runtimePaths.js";
import { LEADERBOARD } from "./leaderboard.js";

export type StepKind = "goto" | "think" | "observe" | "act" | "extract" | "answer" | "judge";

export type ScriptStep = {
  kind: StepKind;
  /** What the agent sees / does / says — short, one line. */
  text: string;
  /** How long the step "takes" in the replay (ms, at speed multiplier 1). */
  ms: number;
  /** Page location after the step, when it changes. */
  url?: string;
  /** Model calls consumed by this step (0 for pure browser steps). */
  calls?: number;
};

export type ScriptedCase = {
  id: string;
  benchmark: "webvoyager";
  site: string;
  /** The real benchmark question. */
  task: string;
  startUrl: string;
  steps: ScriptStep[];
  answer: string;
  verdict: "pass" | "fail";
  /** Judge's one-line reason. */
  reason: string;
  /** Illustrative totals at speed 1. */
  costUsd: number;
};

type DatasetRow = { id: string; web: string; ques: string; web_name?: string };

function readDataset(): Map<string, DatasetRow> {
  const out = new Map<string, DatasetRow>();
  try {
    const p = path.join(getPackageRootDir(), "datasets", "webvoyager", "WebVoyager_data.jsonl");
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      if (!line.trim()) continue;
      const row = JSON.parse(line) as DatasetRow;
      if (row.id) out.set(row.id, row);
    }
  } catch {
    // dataset not shipped in this mode — embedded text below still applies
  }
  return out;
}

const CASES: ScriptedCase[] = [
  {
    id: "Amazon--4",
    benchmark: "webvoyager",
    site: "Amazon",
    task: `Find the used Nintendo Switch Lite on Amazon then filter by 'Used - Good', tell me the cheapest one that is 'Used - Good'.`,
    startUrl: "https://www.amazon.com/",
    steps: [
      { kind: "goto", text: "amazon.com", ms: 1400, url: "amazon.com" },
      {
        kind: "think",
        text: "Search for the console, then narrow to used listings",
        ms: 900,
        calls: 1,
      },
      { kind: "act", text: 'type "Nintendo Switch Lite" into the search box', ms: 700, calls: 1 },
      { kind: "act", text: "press Enter", ms: 500 },
      {
        kind: "observe",
        text: "48 results · filters: Condition, Price, Brand",
        ms: 1100,
        calls: 1,
        url: "amazon.com/s?k=nintendo+switch+lite",
      },
      { kind: "act", text: 'click "Used" under Condition', ms: 800, calls: 1 },
      { kind: "observe", text: "11 used listings · sort: Featured", ms: 900, calls: 1 },
      { kind: "act", text: 'sort by "Price: Low to High"', ms: 800, calls: 1 },
      {
        kind: "extract",
        text: 'first "Used - Good" listing → $139.99, Turquoise',
        ms: 1300,
        calls: 1,
      },
      {
        kind: "answer",
        text: "Cheapest Used - Good: Nintendo Switch Lite (Turquoise), $139.99",
        ms: 600,
        calls: 1,
      },
    ],
    answer: "Nintendo Switch Lite (Turquoise), Used - Good, $139.99",
    verdict: "pass",
    reason: "names a specific used listing with condition and price",
    costUsd: 0.041,
  },
  {
    id: "GitHub--17",
    benchmark: "webvoyager",
    site: "GitHub",
    task: `Locate a C++ project on GitHub that has been recently updated in the last week and has at least 500 stars, then describe its main purpose.`,
    startUrl: "https://github.com/",
    steps: [
      { kind: "goto", text: "github.com", ms: 1200, url: "github.com" },
      {
        kind: "think",
        text: "Use search with language + stars + pushed filters",
        ms: 800,
        calls: 1,
      },
      {
        kind: "act",
        text: 'search "language:C++ stars:>500 pushed:>7 days ago"',
        ms: 900,
        calls: 1,
      },
      {
        kind: "observe",
        text: "3,214 repositories · sort: Best match",
        ms: 1000,
        calls: 1,
        url: "github.com/search?q=language%3AC%2B%2B+stars%3A%3E500",
      },
      { kind: "act", text: 'sort by "Recently updated"', ms: 700, calls: 1 },
      {
        kind: "extract",
        text: "top result: ggml-org/llama.cpp · ★ 84k · updated 2 hours ago",
        ms: 1200,
        calls: 1,
      },
      {
        kind: "act",
        text: "open the repository",
        ms: 900,
        url: "github.com/ggml-org/llama.cpp",
        calls: 1,
      },
      { kind: "extract", text: "description + last commit timestamp", ms: 1000, calls: 1 },
      {
        kind: "answer",
        text: "ggml-org/llama.cpp — LLM inference in C/C++, ★84k, pushed today",
        ms: 600,
        calls: 1,
      },
    ],
    answer: "ggml-org/llama.cpp — LLM inference in C/C++; 84k stars; last push today",
    verdict: "pass",
    reason: "repository matches language, star and recency constraints",
    costUsd: 0.037,
  },
  {
    id: "Coursera--30",
    benchmark: "webvoyager",
    site: "Coursera",
    task: `Locate the course 'Modern Art & Ideas' on Coursera offered by The Museum of Modern Art. Find out the percentage (rounded) of 3-star ratings in the reviews and note which star level has the lowest percentage.`,
    startUrl: "https://www.coursera.org/",
    steps: [
      { kind: "goto", text: "coursera.org", ms: 1300, url: "coursera.org" },
      { kind: "act", text: 'search "Modern Art & Ideas"', ms: 800, calls: 1 },
      {
        kind: "observe",
        text: "results: Modern Art & Ideas · The Museum of Modern Art",
        ms: 1000,
        calls: 1,
      },
      {
        kind: "act",
        text: "open the course page",
        ms: 900,
        url: "coursera.org/learn/modern-art-ideas",
        calls: 1,
      },
      {
        kind: "observe",
        text: "4.8 ★ · 8,102 reviews · no rating breakdown visible",
        ms: 1100,
        calls: 1,
      },
      { kind: "act", text: 'click "Reviews"', ms: 800, calls: 1 },
      {
        kind: "extract",
        text: "5-star share not shown; page lists average only",
        ms: 1200,
        calls: 1,
      },
      {
        kind: "answer",
        text: "About 4.8/5 average; percentage of 5-star reviews not shown",
        ms: 600,
        calls: 1,
      },
    ],
    answer: "4.8/5 average rating (5-star percentage not reported)",
    verdict: "fail",
    reason: "task asks for the 5-star percentage; answer gives the average instead",
    costUsd: 0.033,
  },
];

/** The scripted cases, with question text refreshed from the dataset when available. */
export function loadScriptedCases(): ScriptedCase[] {
  const ds = readDataset();
  return CASES.map((c) => {
    const row = ds.get(c.id);
    return row
      ? { ...c, task: row.ques.trim(), site: row.web_name ?? c.site, startUrl: row.web }
      : c;
  });
}

export function caseTotalMs(c: ScriptedCase): number {
  return c.steps.reduce((a, s) => a + s.ms, 0);
}
export function caseModelCalls(c: ScriptedCase): number {
  return c.steps.reduce((a, s) => a + (s.calls ?? 0), 0);
}

/** A model "personality" for replays: relative speed/cost, and which case index (if any) it fumbles. */
export type ModelProfile = {
  name: string;
  /** Leaderboard accuracy (for context lines). */
  accuracy: number;
  /** Multiplier on step ms (lower = faster). */
  speedMul: number;
  /** Multiplier on cost. */
  costMul: number;
};

/** Top three leaderboard models with relative profiles derived from their public speed/cost. */
export const MODEL_PROFILES: ModelProfile[] = LEADERBOARD.slice(0, 3).map((r, i, arr) => {
  const base = arr[0];
  return {
    name: r.model,
    accuracy: r.accuracy,
    speedMul: Math.max(0.5, Math.min(1.6, r.speedS / base.speedS)),
    costMul: Math.max(0.5, Math.min(5, r.costUsd / base.costUsd)),
  };
});
