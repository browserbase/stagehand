import path from "path";
import type { Testcase, EvalInput } from "../types/evals";
import type { AvailableModel } from "@browserbasehq/stagehand";
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
      allTestcases.push({
        input,
        name: input.name,
        tags: [
          model,
          input.name,
          ...(
            tasksConfig.find((t) => t.name === input.name)?.categories || []
          ).map((x) => `category/${x}`),
          `onlineMind2Web/id/${row.task_id}`,
          ...(row.level ? [`onlineMind2Web/level/${row.level}`] : []),
        ],
        metadata: {
          model: model as AvailableModel,
          test: `${input.name}:${row.task_id}`,
        },
        expected: true,
      });
    }
  }

  return allTestcases;
};
