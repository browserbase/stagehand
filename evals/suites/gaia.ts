import path from "path";
import type { Testcase, EvalInput } from "@/types/evals";
import type { AvailableModel } from "@/types/model";
import { tasksConfig } from "../taskConfig";
import { readJsonlFile, parseJsonlRows, applySampling } from "../utils";

export const buildGAIATestcases = (models: string[]): Testcase[] => {
  const gaiaFilePath =
    process.env.EVAL_GAIA_FILE ||
    path.join(__dirname, "..", "datasets", "gaia", "GAIA_web.jsonl");

  const gaiaLines = readJsonlFile(gaiaFilePath);

  const levelFilter = process.env.EVAL_GAIA_LEVEL
    ? Number(process.env.EVAL_GAIA_LEVEL)
    : undefined;
  // Use EVAL_MAX_K if set, otherwise fall back to EVAL_GAIA_LIMIT or default to 25
  const maxCases = process.env.EVAL_MAX_K
    ? Number(process.env.EVAL_MAX_K)
    : process.env.EVAL_GAIA_LIMIT
      ? Number(process.env.EVAL_GAIA_LIMIT)
      : 25;
  const sampleCount = process.env.EVAL_GAIA_SAMPLE
    ? Number(process.env.EVAL_GAIA_SAMPLE)
    : undefined;

  type GaiaRow = {
    id: string;
    Level?: number;
    web: string;
    ques: string;
    [key: string]: unknown;
  };

  function isGaiaRow(parsed: unknown): parsed is GaiaRow {
    if (parsed === null || typeof parsed !== "object") return false;
    const obj = parsed as Record<string, unknown>;
    return (
      typeof obj.id === "string" &&
      typeof obj.web === "string" &&
      typeof obj.ques === "string"
    );
  }

  const candidates = parseJsonlRows(gaiaLines, isGaiaRow);

  // Filter by level if specified
  const filteredCandidates = levelFilter
    ? candidates.filter((row) => row.Level === levelFilter)
    : candidates;

  const gaiaRows = applySampling(filteredCandidates, sampleCount, maxCases);

  const allTestcases: Testcase[] = [];
  for (const model of models) {
    for (const row of gaiaRows) {
      const finalAnswer = (row as Record<string, unknown>)[
        "Final answer"
      ] as unknown;
      const input: EvalInput = {
        name: "agent/gaia",
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
