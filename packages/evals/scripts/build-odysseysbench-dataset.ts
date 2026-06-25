/**
 * Build packages/evals/datasets/odysseysbench/OdysseysBench_data.jsonl from the
 * published OdysseysBench task set.
 *
 * OdysseysBench (https://odysseysbench.com) is a 200-task web-agent benchmark
 * (45 easy / 46 medium / 109 hard). Every task ships a weighted rubric whose
 * weights sum to 1.0. This script converts each task's `rubrics` map into the
 * verifier's `precomputed_rubric` shape ({ items: [{ criterion, description,
 * max_points }] }) so the suite can hand it straight to V3Evaluator.verify()
 * without generating a rubric.
 *
 * Source of truth is the committed snapshot at
 *   packages/evals/datasets/odysseysbench/source/tasks.json
 * (mirrored from https://odysseysbench.com/assets/data/tasks.json). Re-fetch
 * with `--fetch` to refresh that snapshot before rebuilding.
 *
 * Run after pulling the branch (or whenever the source snapshot changes):
 *   pnpm tsx packages/evals/scripts/build-odysseysbench-dataset.ts
 *
 * Idempotent — regenerates the JSONL deterministically from the snapshot.
 */
import fs from "node:fs/promises";
import path from "node:path";

const SOURCE_URL = "https://odysseysbench.com/assets/data/tasks.json";

const DATASET_DIR = path.join(
  path.resolve(import.meta.dirname, ".."),
  "datasets",
  "odysseysbench",
);
const SOURCE_PATH = path.join(DATASET_DIR, "source", "tasks.json");
const JSONL_PATH = path.join(DATASET_DIR, "OdysseysBench_data.jsonl");

interface SourceRubric {
  requirement: string;
  verification: string;
  weight: number;
}

interface SourceTask {
  task_id: string;
  confirmed_task: string;
  website: string;
  reference_length: number;
  level: "easy" | "medium" | "hard";
  rubrics: Record<string, SourceRubric>;
  categories?: string[];
  num_categories?: number;
}

interface RubricItem {
  criterion: string;
  description: string;
  max_points: number;
}

interface OutputRow {
  task_id: string;
  confirmed_task: string;
  website: string;
  level: "easy" | "medium" | "hard";
  reference_length: number;
  categories?: string[];
  precomputed_rubric: { items: RubricItem[] };
}

/** Order rubric keys R1, R2, … R10 numerically rather than lexicographically. */
function sortRubricKeys(keys: string[]): string[] {
  return [...keys].sort((a, b) => {
    const na = Number.parseInt(a.replace(/^\D+/, ""), 10);
    const nb = Number.parseInt(b.replace(/^\D+/, ""), 10);
    if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
    return a.localeCompare(b);
  });
}

const POINT_SCALE = 1000;

/**
 * Convert one OdysseysBench rubric entry into a verifier rubric item.
 *
 * `weight` (summing to 1.0 across a task) is scaled to integer points. The
 * process score is Σ earned / Σ max, so the absolute scale is immaterial — but
 * rounding is *not* a uniform scaling, so a coarse scale (e.g. ×100) would
 * distort the relative weighting of small criteria. ×1000 keeps the rounding
 * error well under 1% even for the smallest published weights. `max(1, …)` is
 * a defensive floor; with valid weights it never binds.
 */
function toRubricItem(r: SourceRubric): RubricItem {
  return {
    criterion: r.requirement,
    description: `${r.requirement}\n\nHow a grader verifies this: ${r.verification}`,
    max_points: Math.max(1, Math.round(r.weight * POINT_SCALE)),
  };
}

async function loadSource(): Promise<SourceTask[]> {
  if (process.argv.includes("--fetch")) {
    const res = await fetch(SOURCE_URL);
    if (!res.ok) {
      throw new Error(`Failed to fetch ${SOURCE_URL}: ${res.status}`);
    }
    const text = await res.text();
    await fs.mkdir(path.dirname(SOURCE_PATH), { recursive: true });
    await fs.writeFile(SOURCE_PATH, text);
    console.log(`Refreshed snapshot: ${SOURCE_PATH}`);
    return JSON.parse(text) as SourceTask[];
  }
  const text = await fs.readFile(SOURCE_PATH, "utf8");
  return JSON.parse(text) as SourceTask[];
}

async function main(): Promise<void> {
  const tasks = await loadSource();
  if (!Array.isArray(tasks) || tasks.length === 0) {
    throw new Error("Source tasks.json is empty or not an array");
  }

  const lines: string[] = [];
  for (const task of tasks) {
    // Fail loud on an upstream schema change rather than silently emitting a
    // row the suite validator would later drop (shrinking the benchmark).
    if (typeof task.task_id !== "string" || !task.task_id) {
      throw new Error(
        `Task is missing a string task_id: ${JSON.stringify(task).slice(0, 200)}`,
      );
    }
    if (typeof task.confirmed_task !== "string" || !task.confirmed_task) {
      throw new Error(`Task ${task.task_id} is missing confirmed_task`);
    }
    const rubricKeys = sortRubricKeys(Object.keys(task.rubrics ?? {}));
    if (rubricKeys.length === 0) {
      throw new Error(`Task ${task.task_id} has no rubrics`);
    }
    // The published weights are a normalized distribution; a re-fetched snapshot
    // that breaks that convention would silently mis-weight the rubric.
    const weightSum = rubricKeys.reduce(
      (acc, k) => acc + (task.rubrics[k]?.weight ?? 0),
      0,
    );
    if (!Number.isFinite(weightSum) || Math.abs(weightSum - 1) > 0.02) {
      throw new Error(
        `Task ${task.task_id} rubric weights sum to ${weightSum}, expected ~1.0`,
      );
    }
    const items = rubricKeys.map((k) => toRubricItem(task.rubrics[k]));

    const row: OutputRow = {
      task_id: task.task_id,
      confirmed_task: task.confirmed_task,
      website: task.website,
      level: task.level,
      reference_length: task.reference_length,
      ...(Array.isArray(task.categories) && task.categories.length > 0
        ? { categories: task.categories }
        : {}),
      precomputed_rubric: { items },
    };
    lines.push(JSON.stringify(row));
  }

  if (lines.length !== tasks.length) {
    throw new Error(
      `Expected ${tasks.length} rows, produced ${lines.length} — a task was dropped`,
    );
  }

  await fs.writeFile(JSONL_PATH, lines.join("\n") + "\n");
  const byLevel = tasks.reduce<Record<string, number>>((acc, t) => {
    acc[t.level] = (acc[t.level] ?? 0) + 1;
    return acc;
  }, {});
  console.log(
    `Wrote ${lines.length} rows to ${JSONL_PATH} (${JSON.stringify(byLevel)})`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
