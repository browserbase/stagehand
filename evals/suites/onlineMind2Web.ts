import path from "path";
import type { Testcase, EvalInput } from "@/types/evals";
import type { AvailableModel } from "@/types/model";
import { tasksConfig } from "../taskConfig";
import { readJsonlFile, parseJsonlRows, applySampling } from "../utils";

export const buildOnlineMind2WebTestcases = (models: string[]): Testcase[] => {
  const mind2webFilePath = path.join(
    __dirname,
    "..",
    "datasets",
    "onlineMind2Web",
    "onlineMind2Web.jsonl",
  );

  const lines = readJsonlFile(mind2webFilePath);

  // Use EVAL_MAX_K if set, otherwise fall back to EVAL_ONLINEMIND2WEB_LIMIT or default to 25
  const maxCases = process.env.EVAL_MAX_K
    ? Number(process.env.EVAL_MAX_K)
    : process.env.EVAL_ONLINEMIND2WEB_LIMIT
      ? Number(process.env.EVAL_ONLINEMIND2WEB_LIMIT)
      : 25;
  const sampleCount = process.env.EVAL_ONLINEMIND2WEB_SAMPLE
    ? Number(process.env.EVAL_ONLINEMIND2WEB_SAMPLE)
    : undefined;

  type Mind2WebRow = {
    task_id: string;
    confirmed_task: string;
    website: string;
    reference_length?: number;
    level?: string;
    [key: string]: unknown;
  };

  function isMind2WebRow(parsed: unknown): parsed is Mind2WebRow {
    if (parsed === null || typeof parsed !== "object") return false;
    const obj = parsed as Record<string, unknown>;
    return (
      typeof obj.task_id === "string" &&
      typeof obj.confirmed_task === "string" &&
      typeof obj.website === "string"
    );
  }

  const candidates = parseJsonlRows(lines, isMind2WebRow);
  const rows = applySampling(candidates, sampleCount, maxCases);

  const allTestcases: Testcase[] = [];
  for (const model of models) {
    for (const row of rows) {
      const input: EvalInput = {
        name: "agent/onlineMind2Web",
        modelName: model as AvailableModel,
        params: {
          task_id: row.task_id,
          confirmed_task: row.confirmed_task,
          website: row.website,
          reference_length: row.reference_length,
          level: row.level,
        },
      };
      const taskCategories =
        tasksConfig.find((t) => t.name === input.name)?.categories || [];
      allTestcases.push({
        input,
        name: input.name,
        tags: [
          model,
          "mind2web", // Simple dataset tag
        ],
        metadata: {
          model: model as AvailableModel,
          test: `${input.name}:${row.task_id}`,
          category: taskCategories[0] || "agent",
          categories: taskCategories,
          dataset: "onlineMind2Web",
          task_id: row.task_id,
          difficulty: row.level,
          website: row.website,
        },
        expected: true,
      });
    }
  }

  return allTestcases;
};
