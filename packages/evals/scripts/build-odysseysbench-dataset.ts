import fs from "node:fs/promises";
import path from "node:path";

const SOURCE_URL = "https://odysseysbench.com/assets/data/tasks.json";

const DATASET_DIR = path.join(path.resolve(import.meta.dirname, ".."), "datasets", "odysseysbench");
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

function sortRubricKeys(keys: string[]): string[] {
  return [...keys].sort((a, b) => {
    const na = Number.parseInt(a.replace(/^\D+/, ""), 10);
    const nb = Number.parseInt(b.replace(/^\D+/, ""), 10);
    if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
    return a.localeCompare(b);
  });
}

const POINT_SCALE = 1000;

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
    if (typeof task.task_id !== "string" || !task.task_id) {
      throw new Error(`Task is missing a string task_id: ${JSON.stringify(task).slice(0, 200)}`);
    }
    if (typeof task.confirmed_task !== "string" || !task.confirmed_task) {
      throw new Error(`Task ${task.task_id} is missing confirmed_task`);
    }
    const rubricKeys = sortRubricKeys(Object.keys(task.rubrics ?? {}));
    if (rubricKeys.length === 0) {
      throw new Error(`Task ${task.task_id} has no rubrics`);
    }
    for (const k of rubricKeys) {
      const r = task.rubrics[k];
      if (typeof r?.requirement !== "string" || !r.requirement.trim()) {
        throw new Error(`Task ${task.task_id} rubric ${k} has an empty requirement`);
      }
      if (typeof r.verification !== "string" || !r.verification.trim()) {
        throw new Error(`Task ${task.task_id} rubric ${k} has an empty verification`);
      }
      if (
        typeof r.weight !== "number" ||
        !Number.isFinite(r.weight) ||
        r.weight <= 0 ||
        r.weight > 1
      ) {
        throw new Error(
          `Task ${task.task_id} rubric ${k} has invalid weight ${r.weight}; expected a number in (0, 1]`,
        );
      }
    }
    const weightSum = rubricKeys.reduce((acc, k) => acc + task.rubrics[k].weight, 0);
    if (Math.abs(weightSum - 1) > 0.02) {
      throw new Error(`Task ${task.task_id} rubric weights sum to ${weightSum}, expected ~1.0`);
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
    throw new Error(`Expected ${tasks.length} rows, produced ${lines.length} — a task was dropped`);
  }

  await fs.writeFile(JSONL_PATH, lines.join("\n") + "\n");
  const byLevel = tasks.reduce<Record<string, number>>((acc, t) => {
    acc[t.level] = (acc[t.level] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`Wrote ${lines.length} rows to ${JSONL_PATH} (${JSON.stringify(byLevel)})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
