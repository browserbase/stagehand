import type { Testcase, EvalInput, AgentModelEntry } from "../types/evals.js";
import { normalizeRubric, type AvailableModel } from "stagehand-v3";
import { tasksConfig } from "../taskConfig.js";
import { getPackageRootDir } from "../runtimePaths.js";
import {
  readJsonlFile,
  parseJsonlRows,
  applySampling,
  normalizeAgentModelEntries,
} from "../utils.js";

function parsePositiveIntEnv(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

export const buildOdysseysBenchTestcases = (models: string[] | AgentModelEntry[]): Testcase[] => {
  const odysseysbenchFilePath =
    getPackageRootDir() + "/datasets/odysseysbench/OdysseysBench_data.jsonl";

  const lines = readJsonlFile(odysseysbenchFilePath);

  const maxCases =
    parsePositiveIntEnv(process.env.EVAL_MAX_K) ??
    parsePositiveIntEnv(process.env.EVAL_ODYSSEYSBENCH_LIMIT) ??
    25;
  const sampleCount = parsePositiveIntEnv(process.env.EVAL_ODYSSEYSBENCH_SAMPLE);

  type OdysseysBenchRow = {
    task_id: string;
    confirmed_task: string;
    website?: string;
    level?: "easy" | "medium" | "hard";
    reference_length?: number;
    categories?: string[];
    precomputed_rubric?: unknown;
    [key: string]: unknown;
  };

  function isOdysseysBenchRow(parsed: unknown): parsed is OdysseysBenchRow {
    if (parsed === null || typeof parsed !== "object") return false;
    const obj = parsed as Record<string, unknown>;
    return typeof obj.task_id === "string" && typeof obj.confirmed_task === "string";
  }

  const candidates = parseJsonlRows(lines, isOdysseysBenchRow);

  const explicitIds = process.env.EVAL_ODYSSEYSBENCH_IDS
    ? process.env.EVAL_ODYSSEYSBENCH_IDS.split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : null;

  let rows: OdysseysBenchRow[];
  if (explicitIds && explicitIds.length > 0) {
    const byId = new Map(candidates.map((r) => [r.task_id, r]));
    rows = explicitIds.map((id) => byId.get(id)).filter((r): r is OdysseysBenchRow => Boolean(r));
  } else {
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
      const taskCategories = tasksConfig.find((t) => t.name === input.name)?.categories || [];
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
