import path from "path";
import fs from "fs";
import Papa from "papaparse";
import type { Testcase, EvalInput } from "@/types/evals";
import type { AvailableModel } from "@/types/model";
import { tasksConfig } from "../taskConfig";
import { applySampling } from "../utils";

type WebBenchRow = {
  id: string;
  url: string;
  category: "READ" | "CREATE" | "UPDATE" | "DELETE" | "FILE_MANIPULATION";
  difficulty?: "easy" | "hard";
  task: string;
};

function parseCSV(content: string): Array<Record<string, string>> {
  const result = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: true,
    // This handles multi-line fields automatically
  });

  if (result.errors.length > 0) {
    console.error("CSV parsing errors:", result.errors);
  }

  return result.data;
}

function parseWebBenchRow(row: Record<string, string>): WebBenchRow | null {
  const id = row["ID"];
  const url = row["Starting URL"];
  const category = row["Category"] as WebBenchRow["category"];
  const task = row["Task"];
  const difficulty = row["Difficulty"] as WebBenchRow["difficulty"] | undefined;

  if (!id || !url || !category || !task) {
    return null;
  }

  // Validate category
  const validCategories = [
    "READ",
    "CREATE",
    "UPDATE",
    "DELETE",
    "FILE_MANIPULATION",
  ];
  if (!validCategories.includes(category)) {
    return null;
  }

  return {
    id,
    url,
    category,
    difficulty:
      difficulty && ["easy", "hard"].includes(difficulty)
        ? difficulty
        : undefined,
    task,
  };
}

function mergeWebBenchDatasets(
  mainRows: WebBenchRow[],
  hitlRows: WebBenchRow[],
): WebBenchRow[] {
  // Create a map with HITL rows (these have difficulty ratings)
  const mergedMap = new Map<string, WebBenchRow>();

  // First add all HITL rows (they have difficulty ratings)
  for (const row of hitlRows) {
    mergedMap.set(row.id, row);
  }

  // Then add main rows only if ID doesn't exist (avoid duplicates)
  for (const row of mainRows) {
    if (!mergedMap.has(row.id)) {
      mergedMap.set(row.id, row);
    }
  }

  return Array.from(mergedMap.values());
}

export const buildWebBenchTestcases = (models: string[]): Testcase[] => {
  /**
   * Environment Variables:
   *
   * EVAL_WEBBENCH_DIFFICULTY - Filter tasks by difficulty level
   *   Options: "easy" | "hard" | undefined (all)
   *   Example: EVAL_WEBBENCH_DIFFICULTY=easy
   *
   * EVAL_WEBBENCH_CATEGORY - Filter tasks by category
   *   Options: "READ" | "CREATE" | "UPDATE" | "DELETE" | "FILE_MANIPULATION"
   *   Example: EVAL_WEBBENCH_CATEGORY=READ
   *
   * EVAL_WEBBENCH_USE_HITL - Use only HITL dataset (has difficulty ratings)
   *   Options: "true" | "false" (default: false)
   *   Example: EVAL_WEBBENCH_USE_HITL=true
   *
   * EVAL_WEBBENCH_LIMIT - Maximum number of tasks to run
   *   Default: 25
   *   Example: EVAL_WEBBENCH_LIMIT=10
   *
   * EVAL_WEBBENCH_SAMPLE - Random sample size before applying limit
   *   Optional: If set, randomly samples this many tasks before applying limit
   *   Example: EVAL_WEBBENCH_SAMPLE=100 EVAL_WEBBENCH_LIMIT=10
   *
   * EVAL_MAX_K - Global override for all benchmark limits
   *   Overrides EVAL_WEBBENCH_LIMIT if set
   *   Example: EVAL_MAX_K=5
   */

  // Read environment variables
  const difficultyFilter = process.env.EVAL_WEBBENCH_DIFFICULTY as
    | "easy"
    | "hard"
    | undefined;
  const categoryFilter = process.env.EVAL_WEBBENCH_CATEGORY as
    | WebBenchRow["category"]
    | undefined;
  const useHitlOnly = process.env.EVAL_WEBBENCH_USE_HITL === "true";
  const maxCases = process.env.EVAL_MAX_K
    ? Number(process.env.EVAL_MAX_K)
    : process.env.EVAL_WEBBENCH_LIMIT
      ? Number(process.env.EVAL_WEBBENCH_LIMIT)
      : 25;
  const sampleCount = process.env.EVAL_WEBBENCH_SAMPLE
    ? Number(process.env.EVAL_WEBBENCH_SAMPLE)
    : undefined;

  // Read main dataset
  const mainFilePath = path.join(
    __dirname,
    "..",
    "datasets",
    "webbench",
    "webbenchfinal.csv",
  );
  const mainContent = fs.readFileSync(mainFilePath, "utf-8");
  const mainParsed = parseCSV(mainContent);
  const mainRows = mainParsed
    .map(parseWebBenchRow)
    .filter((row): row is WebBenchRow => row !== null);

  // Read HITL dataset
  const hitlFilePath = path.join(
    __dirname,
    "..",
    "datasets",
    "webbench",
    "webbench_hitl_final.csv",
  );
  const hitlContent = fs.readFileSync(hitlFilePath, "utf-8");
  const hitlParsed = parseCSV(hitlContent);
  const hitlRows = hitlParsed
    .map(parseWebBenchRow)
    .filter((row): row is WebBenchRow => row !== null);

  // Merge datasets (HITL takes precedence for duplicates)
  let rows: WebBenchRow[];
  if (useHitlOnly) {
    rows = hitlRows;
  } else {
    rows = mergeWebBenchDatasets(mainRows, hitlRows);
  }

  // Apply filters
  if (difficultyFilter) {
    rows = rows.filter((row) => row.difficulty === difficultyFilter);
  }

  if (categoryFilter) {
    rows = rows.filter((row) => row.category === categoryFilter);
  }

  // Apply sampling
  const sampledRows = applySampling(rows, sampleCount, maxCases);

  // Generate testcases
  const allTestcases: Testcase[] = [];
  for (const model of models) {
    for (const row of sampledRows) {
      const input: EvalInput = {
        name: "agent/webbench",
        modelName: model as AvailableModel,
        params: {
          id: row.id,
          url: row.url,
          category: row.category,
          difficulty: row.difficulty,
          task: row.task,
        },
      };

      // Extract hostname from URL for tagging
      let hostname = "unknown";
      try {
        hostname = new URL(row.url).hostname.replace("www.", "");
      } catch {
        // Keep as unknown if URL parsing fails
      }

      allTestcases.push({
        input,
        name: input.name,
        tags: [
          model,
          input.name,
          ...(
            tasksConfig.find((t) => t.name === input.name)?.categories || []
          ).map((x) => `category/${x}`),
          `webbench/id/${row.id}`,
          `webbench/category/${row.category}`,
          row.difficulty
            ? `webbench/difficulty/${row.difficulty}`
            : "webbench/difficulty/unknown",
          `webbench/site/${hostname}`,
        ],
        metadata: {
          model: model as AvailableModel,
          test: `${input.name}:${row.id}`,
        },
        expected: true,
      });
    }
  }

  return allTestcases;
};
