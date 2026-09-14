/**
 * Scripted agent trajectories for the welcome flows.
 *
 * The case is a REAL WebVoyager benchmark task (id + site + question come
 * from datasets/webvoyager/WebVoyager_data.jsonl, re-read at runtime when
 * present). The steps are a hand-written, deterministic replay of how an
 * agent solves it — observe → act → extract → answer → judge — so onboarding
 * can show what an agent run looks like without a key, a browser, or a bill.
 * Timings and costs are illustrative and labelled as such by the callers.
 */

import fs from "node:fs";
import path from "node:path";
import { getPackageRootDir } from "../../runtimePaths.js";

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

/**
 * The three lanes of the run: names from the public board, pacing tuned for
 * the replay's story — the champion wins, a second model passes but arrives
 * last, the fastest one fails. Lane order is the podium's expected order.
 */
export const MODEL_PROFILES: ModelProfile[] = [
  { name: "Claude Fable 5.1", accuracy: 92.1, speedMul: 1.0, costMul: 1.0 },
  { name: "Claude Opus 5", accuracy: 85.7, speedMul: 1.6, costMul: 2.4 },
  { name: "GPT-5.6-Sol", accuracy: 85.7, speedMul: 0.55, costMul: 4.3 },
];
