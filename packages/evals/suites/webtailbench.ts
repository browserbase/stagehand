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

export const buildWebTailBenchTestcases = (
  models: string[] | AgentModelEntry[],
): Testcase[] => {
  const webtailbenchFilePath =
    getPackageRootDir() + "/datasets/webtailbench/WebTailBench_data.jsonl";

  const lines = readJsonlFile(webtailbenchFilePath);

  // Use EVAL_MAX_K if set, otherwise fall back to EVAL_WEBTAILBENCH_LIMIT or default to 25
  const maxCases = process.env.EVAL_MAX_K
    ? Number(process.env.EVAL_MAX_K)
    : process.env.EVAL_WEBTAILBENCH_LIMIT
      ? Number(process.env.EVAL_WEBTAILBENCH_LIMIT)
      : 25;
  const sampleCount = process.env.EVAL_WEBTAILBENCH_SAMPLE
    ? Number(process.env.EVAL_WEBTAILBENCH_SAMPLE)
    : undefined;

  type WebTailBenchRow = {
    id: string;
    ques: string;
    category?: string;
    web?: string;
    /**
     * Per-task rubric ported from microsoft/WebTailBench-v1-rubrics.tsv
     * via packages/evals/scripts/backfill-webtailbench-rubrics.ts.
     * When present, the verifier uses these upstream criteria directly.
     */
    precomputed_rubric?: unknown;
    [key: string]: unknown;
  };

  function isWebTailBenchRow(parsed: unknown): parsed is WebTailBenchRow {
    if (parsed === null || typeof parsed !== "object") return false;
    const obj = parsed as Record<string, unknown>;
    return typeof obj.id === "string" && typeof obj.ques === "string";
  }

  const candidates = parseJsonlRows(lines, isWebTailBenchRow);

  // EVAL_WEBTAILBENCH_IDS restricts the suite to exactly those task IDs,
  // preserving the order given and ignoring sampling / limit knobs.
  const explicitIds = process.env.EVAL_WEBTAILBENCH_IDS
    ? process.env.EVAL_WEBTAILBENCH_IDS.split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : null;
  let rows: WebTailBenchRow[];
  if (explicitIds && explicitIds.length > 0) {
    const byId = new Map(candidates.map((r) => [r.id, r]));
    rows = explicitIds
      .map((id) => byId.get(id))
      .filter((r): r is WebTailBenchRow => Boolean(r));
  } else {
    rows = applySampling(candidates, sampleCount, maxCases);
  }

  const allTestcases: Testcase[] = [];
  for (const modelEntry of normalizeAgentModelEntries(models)) {
    for (const row of rows) {
      const input: EvalInput = {
        name: "agent/webtailbench",
        modelName: modelEntry.modelName as AvailableModel,
        agentMode: modelEntry.mode,
        isCUA: modelEntry.mode === "cua",
        params: {
          id: row.id,
          category: row.category,
          ques: row.ques,
          web: row.web,
          precomputed_rubric: normalizeRubric(row.precomputed_rubric),
        },
      };
      const taskCategories =
        tasksConfig.find((t) => t.name === input.name)?.categories || [];
      allTestcases.push({
        input,
        name: input.name,
        tags: [modelEntry.modelName, modelEntry.mode, "webtailbench"],
        metadata: {
          model: modelEntry.modelName as AvailableModel,
          test: `${input.name}:${row.id}`,
          tier: "bench",
          task: input.name,
          category: taskCategories[0] || "agent",
          categories: taskCategories,
          dataset: "webtailbench",
          task_id: row.id,
          task_category: row.category,
        },
        expected: true,
      });
    }
  }

  return allTestcases;
};
