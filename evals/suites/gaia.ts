import fs from "fs";
import path from "path";
import type { Testcase, EvalInput } from "@/types/evals";
import type { AvailableModel } from "@/types/model";
import { tasksConfig } from "../taskConfig";

export const buildGAIATestcases = (models: string[]): Testcase[] => {
  const gaiaFilePath =
    process.env.EVAL_GAIA_FILE ||
    path.join(__dirname, "..", "datasets", "gaia", "GAIA_web.jsonl");

  let gaiaLines: string[] = [];
  try {
    const content = fs.readFileSync(gaiaFilePath, "utf-8");
    gaiaLines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  } catch (e) {
    console.warn(
      `Could not read GAIA file at ${gaiaFilePath}. Set EVAL_GAIA_FILE to override. Error: ${e instanceof Error ? e.message : String(e)}`,
    );
    gaiaLines = [];
  }

  const levelFilter = process.env.EVAL_GAIA_LEVEL
    ? Number(process.env.EVAL_GAIA_LEVEL)
    : undefined;
  const maxCases = process.env.EVAL_GAIA_LIMIT
    ? Number(process.env.EVAL_GAIA_LIMIT)
    : 25;

  type GaiaRow = {
    id: string;
    Level?: number;
    web: string;
    ques: string;
    [key: string]: unknown;
  };

  const gaiaRows: GaiaRow[] = [];
  for (const line of gaiaLines) {
    try {
      const parsed = JSON.parse(line) as GaiaRow;
      if (
        typeof parsed.id === "string" &&
        typeof parsed.web === "string" &&
        typeof parsed.ques === "string"
      ) {
        if (!levelFilter || parsed.Level === levelFilter) {
          gaiaRows.push(parsed);
        }
      }
    } catch {
      // skip invalid lines
    }
    if (gaiaRows.length >= maxCases) break;
  }

  const allTestcases: Testcase[] = [];
  for (const model of models) {
    for (const row of gaiaRows) {
      const finalAnswer = (row as Record<string, unknown>)[
        "Final answer"
      ] as unknown;
      const input: EvalInput = {
        name: "agent/webarena_gaia",
        modelName: model as AvailableModel,
        params: {
          id: row.id,
          level: row.Level,
          web: row.web,
          ques: row.ques,
          expected: typeof finalAnswer === "string" ? finalAnswer : undefined,
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
          `gaia/id/${row.id}`,
          row.Level ? `gaia/level/${row.Level}` : "gaia/level/unknown",
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
