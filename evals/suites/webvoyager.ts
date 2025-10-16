import path from "path";
import type { Testcase, EvalInput } from "@/types/evals";
import type { AvailableModel } from "@/types/model";
import { tasksConfig } from "../taskConfig";
import { readJsonlFile, parseJsonlRows, applySampling } from "../utils";

export const buildWebVoyagerTestcases = (models: string[]): Testcase[] => {
  const voyagerFilePath = path.join(
    __dirname,
    "..",
    "datasets",
    "webvoyager",
    "WebVoyager_data.jsonl",
  );

  const lines = readJsonlFile(voyagerFilePath);

  // Use EVAL_MAX_K if set, otherwise fall back to EVAL_WEBVOYAGER_LIMIT or default to 25
  const maxCases = process.env.EVAL_MAX_K
    ? Number(process.env.EVAL_MAX_K)
    : process.env.EVAL_WEBVOYAGER_LIMIT
      ? Number(process.env.EVAL_WEBVOYAGER_LIMIT)
      : 25;
  const sampleCount = process.env.EVAL_WEBVOYAGER_SAMPLE
    ? Number(process.env.EVAL_WEBVOYAGER_SAMPLE)
    : undefined;

  type VoyagerRow = {
    id: string;
    web: string;
    ques: string;
    web_name?: string;
    [key: string]: unknown;
  };

  function isVoyagerRow(parsed: unknown): parsed is VoyagerRow {
    if (parsed === null || typeof parsed !== "object") return false;
    const obj = parsed as Record<string, unknown>;
    return (
      typeof obj.id === "string" &&
      typeof obj.web === "string" &&
      typeof obj.ques === "string"
    );
  }

  const candidates = parseJsonlRows(lines, isVoyagerRow);
  const rows = applySampling(candidates, sampleCount, maxCases);

  const allTestcases: Testcase[] = [];
  for (const model of models) {
    for (const row of rows) {
      const input: EvalInput = {
        name: "agent/webvoyager",
        modelName: model as AvailableModel,
        params: {
          id: row.id,
          web: row.web,
          ques: row.ques,
          web_name: row.web_name,
        },
      };
      const taskCategories =
        tasksConfig.find((t) => t.name === input.name)?.categories || [];
      allTestcases.push({
        input,
        name: input.name,
        tags: [
          model,
          "webvoyager", // Simple dataset tag
        ],
        metadata: {
          model: model as AvailableModel,
          test: `${input.name}:${row.id}`,
          category: taskCategories[0] || "agent",
          categories: taskCategories,
          dataset: "webvoyager",
          task_id: row.id,
          website: row.web_name,
        },
        expected: true,
      });
    }
  }

  return allTestcases;
};
