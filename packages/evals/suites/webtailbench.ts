import type { Testcase, EvalInput } from "../types/evals.js";
import type { AvailableModel } from "@browserbasehq/stagehand";
import { tasksConfig } from "../taskConfig.js";
import { getCurrentDirPath } from "../runtimePaths.js";
import { readJsonlFile, parseJsonlRows, applySampling } from "../utils.js";

export const buildWebTailBenchTestcases = (models: string[]): Testcase[] => {
  const moduleDir = getCurrentDirPath();
  const webtailbenchFilePath =
    moduleDir + "/../datasets/webtailbench/WebTailBench_data.jsonl";

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
    [key: string]: unknown;
  };

  function isWebTailBenchRow(parsed: unknown): parsed is WebTailBenchRow {
    if (parsed === null || typeof parsed !== "object") return false;
    const obj = parsed as Record<string, unknown>;
    return typeof obj.id === "string" && typeof obj.ques === "string";
  }

  const candidates = parseJsonlRows(lines, isWebTailBenchRow);
  const rows = applySampling(candidates, sampleCount, maxCases);

  const allTestcases: Testcase[] = [];
  for (const model of models) {
    for (const row of rows) {
      const input: EvalInput = {
        name: "agent/webtailbench",
        modelName: model as AvailableModel,
        params: {
          id: row.id,
          category: row.category,
          ques: row.ques,
          web: row.web,
        },
      };
      const taskCategories =
        tasksConfig.find((t) => t.name === input.name)?.categories || [];
      allTestcases.push({
        input,
        name: input.name,
        tags: [model, "webtailbench"],
        metadata: {
          model: model as AvailableModel,
          test: `${input.name}:${row.id}`,
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
