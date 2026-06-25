import type { Testcase, EvalInput, AgentModelEntry } from "../types/evals.js";
import { normalizeRubric, type AvailableModel } from "@browserbasehq/stagehand";
import { tasksConfig } from "../taskConfig.js";
import { getPackageRootDir } from "../runtimePaths.js";
import {
  readJsonlFile,
  parseJsonlRows,
  applySampling,
  normalizeAgentModelEntries,
} from "../utils.js";

/**
 * Build OdysseysBench testcases.
 *
 * OdysseysBench (https://odysseysbench.com) is a 200-task web-agent benchmark
 * spanning easy/medium/hard difficulty. Every task ships a weighted rubric
 * (baked into `precomputed_rubric` by scripts/build-odysseysbench-dataset.ts),
 * so the verifier scores against the published criteria directly rather than
 * generating its own.
 *
 * Env knobs:
 *   - EVAL_MAX_K / EVAL_ODYSSEYSBENCH_LIMIT — cap the number of tasks (default 25).
 *   - EVAL_ODYSSEYSBENCH_SAMPLE — random sample size (overrides the limit cap).
 *   - EVAL_ODYSSEYSBENCH_LEVEL — comma-separated difficulty filter (easy,medium,hard).
 *   - EVAL_ODYSSEYSBENCH_IDS — comma-separated task_ids to run exactly, in order
 *     (ignores sampling / limit / level knobs).
 */
/** Parse an env var to a positive integer; undefined for unset/non-numeric. */
function parsePositiveIntEnv(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

export const buildOdysseysBenchTestcases = (
  models: string[] | AgentModelEntry[],
): Testcase[] => {
  const odysseysbenchFilePath =
    getPackageRootDir() + "/datasets/odysseysbench/OdysseysBench_data.jsonl";

  const lines = readJsonlFile(odysseysbenchFilePath);

  // Ignore unset / non-numeric env values rather than letting Number("foo")
  // become NaN, which would slip past applySampling's `>= maxCases` cap and
  // silently fan out the full 200-task dataset.
  const maxCases =
    parsePositiveIntEnv(process.env.EVAL_MAX_K) ??
    parsePositiveIntEnv(process.env.EVAL_ODYSSEYSBENCH_LIMIT) ??
    25;
  const sampleCount = parsePositiveIntEnv(
    process.env.EVAL_ODYSSEYSBENCH_SAMPLE,
  );

  type OdysseysBenchRow = {
    task_id: string;
    confirmed_task: string;
    website?: string;
    level?: "easy" | "medium" | "hard";
    reference_length?: number;
    categories?: string[];
    /**
     * Per-task weighted rubric in verifier `{ items: [...] }` shape, produced
     * from the published rubrics by scripts/build-odysseysbench-dataset.ts.
     */
    precomputed_rubric?: unknown;
    [key: string]: unknown;
  };

  function isOdysseysBenchRow(parsed: unknown): parsed is OdysseysBenchRow {
    if (parsed === null || typeof parsed !== "object") return false;
    const obj = parsed as Record<string, unknown>;
    return (
      typeof obj.task_id === "string" && typeof obj.confirmed_task === "string"
    );
  }

  const candidates = parseJsonlRows(lines, isOdysseysBenchRow);

  // EVAL_ODYSSEYSBENCH_IDS restricts the suite to exactly those task IDs,
  // preserving the order given and ignoring sampling / limit / level knobs.
  const explicitIds = process.env.EVAL_ODYSSEYSBENCH_IDS
    ? process.env.EVAL_ODYSSEYSBENCH_IDS.split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : null;

  let rows: OdysseysBenchRow[];
  if (explicitIds && explicitIds.length > 0) {
    const byId = new Map(candidates.map((r) => [r.task_id, r]));
    rows = explicitIds
      .map((id) => byId.get(id))
      .filter((r): r is OdysseysBenchRow => Boolean(r));
  } else {
    // Optional difficulty filter, applied before sampling.
    const levelFilter = process.env.EVAL_ODYSSEYSBENCH_LEVEL
      ? new Set(
          process.env.EVAL_ODYSSEYSBENCH_LEVEL.split(",")
            .map((s) => s.trim().toLowerCase())
            .filter(Boolean),
        )
      : null;
    const filtered = levelFilter
      ? candidates.filter((r) => r.level && levelFilter.has(r.level))
      : candidates;
    rows = applySampling(filtered, sampleCount, maxCases);
  }

  const allTestcases: Testcase[] = [];
  for (const modelEntry of normalizeAgentModelEntries(models)) {
    for (const row of rows) {
      const input: EvalInput = {
        name: "agent/odysseysbench",
        modelName: modelEntry.modelName as AvailableModel,
        agentMode: modelEntry.mode,
        isCUA: modelEntry.mode === "cua",
        params: {
          task_id: row.task_id,
          confirmed_task: row.confirmed_task,
          website: row.website,
          level: row.level,
          reference_length: row.reference_length,
          precomputed_rubric: normalizeRubric(row.precomputed_rubric),
        },
      };
      const taskCategories =
        tasksConfig.find((t) => t.name === input.name)?.categories || [];
      allTestcases.push({
        input,
        name: input.name,
        tags: [modelEntry.modelName, modelEntry.mode, "odysseysbench"],
        metadata: {
          model: modelEntry.modelName as AvailableModel,
          test: `${input.name}:${row.task_id}`,
          tier: "bench",
          task: input.name,
          category: taskCategories[0] || "agent",
          categories: taskCategories,
          dataset: "odysseysbench",
          task_id: row.task_id,
          task_category: row.level,
        },
        expected: true,
      });
    }
  }

  return allTestcases;
};
