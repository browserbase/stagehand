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

/**
 * Convert one OdysseysBench rubric entry into a verifier rubric item.
 *
 * `weight` (summing to 1.0 across a task) is scaled to integer points so the
 * scoring model reasons over a natural 0–100 scale; the process score is a
 * ratio, so the exact scale is immaterial. `max(1, …)` keeps every criterion
 * worth at least one point.
 */
function toRubricItem(key: string, r: SourceRubric): RubricItem {
  return {
    criterion: r.requirement,
    description: `${r.requirement}\n\nHow a grader verifies this: ${r.verification}`,
    max_points: Math.max(1, Math.round(r.weight * 100)),
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
    const rubricKeys = sortRubricKeys(Object.keys(task.rubrics ?? {}));
    if (rubricKeys.length === 0) {
      throw new Error(`Task ${task.task_id} has no rubrics`);
    }
    const items = rubricKeys.map((k) => toRubricItem(k, task.rubrics[k]));

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
