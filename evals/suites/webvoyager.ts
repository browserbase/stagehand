import fs from "fs";
import path from "path";
import type { Testcase, EvalInput } from "@/types/evals";
import type { AvailableModel } from "@/types/model";
import { tasksConfig } from "../taskConfig";

export const buildWebVoyagerTestcases = (models: string[]): Testcase[] => {
  const voyagerFilePath = path.join(
    __dirname,
    "..",
    "datasets",
    "webvoyager",
    "WebVoyager_data.jsonl",
  );

  let lines: string[] = [];
  try {
    const content = fs.readFileSync(voyagerFilePath, "utf-8");
    lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  } catch (e) {
    console.warn(
      `Could not read WebVoyager file at ${voyagerFilePath}. Error: ${e instanceof Error ? e.message : String(e)}`,
    );
    lines = [];
  }

  const maxCases = process.env.EVAL_WEBVOYAGER_LIMIT
    ? Number(process.env.EVAL_WEBVOYAGER_LIMIT)
    : 25;

  type VoyagerRow = {
    id: string;
    web: string;
    ques: string;
    web_name?: string;
    [key: string]: unknown;
  };

  const rows: VoyagerRow[] = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as VoyagerRow;
      if (
        typeof parsed.id === "string" &&
        typeof parsed.web === "string" &&
        typeof parsed.ques === "string"
      ) {
        rows.push(parsed);
      }
    } catch {
      // skip invalid
    }
    if (rows.length >= maxCases) break;
  }

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
      allTestcases.push({
        input,
        name: input.name,
        tags: [
          model,
          input.name,
          ...(
            tasksConfig.find((t) => t.name === input.name)?.categories || []
          ).map((x) => `category/${x}`),
          `webvoyager/id/${row.id}`,
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
