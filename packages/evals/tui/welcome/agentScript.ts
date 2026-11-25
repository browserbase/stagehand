import fs from "node:fs";
import path from "node:path";
import { getPackageRootDir } from "../../runtimePaths.js";

export type StepKind = "goto" | "think" | "observe" | "act" | "extract" | "answer" | "judge";

export type ScriptStep = {
  kind: StepKind;
  text: string;
  ms: number;
  url?: string;
  calls?: number;
};

export type ScriptedCase = {
  id: string;
  benchmark: "webvoyager";
  site: string;
  task: string;
  startUrl: string;
  steps: ScriptStep[];
  answer: string;
  verdict: "pass" | "fail";
  reason: string;
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
  } catch {}
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
      { kind: "act", text: 'type "Nintendo Switch Lite" in the search box', ms: 700, calls: 1 },
      { kind: "act", text: "press Enter", ms: 500 },
      {
        kind: "observe",
        text: "48 results · filters: Condition, Price, Brand",
        ms: 1100,
        calls: 1,
        url: "amazon.com/s?k=nintendo+switch+lite",
      },
      { kind: "act", text: 'click "Used - Good" under Condition', ms: 800, calls: 1 },
      { kind: "observe", text: '4 "Used - Good" listings · sort: Featured', ms: 900, calls: 1 },
      { kind: "act", text: 'sort by "Price: Low to High"', ms: 800, calls: 1 },
      {
        kind: "extract",
        text: "first listing → $139.99, Turquoise",
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

export function loadScriptedCases(): ScriptedCase[] {
  const ds = readDataset();
  return CASES.map((c) => {
    const row = ds.get(c.id);
    return row
      ? { ...c, task: row.ques.trim(), site: row.web_name ?? c.site, startUrl: row.web }
      : c;
  });
}

export type ModelProfile = {
  name: string;
  speedMul: number;
  costMul: number;
};

export const MODEL_PROFILES: ModelProfile[] = [
  { name: "Opus", speedMul: 1.0, costMul: 1.0 },
  { name: "Grok", speedMul: 1.6, costMul: 2.4 },
  { name: "Sol", speedMul: 0.55, costMul: 0.6 },
];
