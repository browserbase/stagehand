import path from "path";
import type { Testcase, EvalInput } from "../types/evals";
import type { AvailableModel } from "@browserbasehq/stagehand";
import { tasksConfig } from "../taskConfig";
import { readJsonlFile, parseJsonlRows, applySampling } from "../utils";
import { SKILL_CONFIGS } from "../lib/skillAgents";

export const buildOnlineMind2WebSkillsTestcases = (
  skills?: string[]
): Testcase[] => {
  const mind2webFilePath = path.join(
    __dirname,
    "..",
    "datasets",
    "onlineMind2Web",
    "onlineMind2Web.jsonl",
  );

  const lines = readJsonlFile(mind2webFilePath);

  const maxCases = process.env.EVAL_MAX_K
    ? Number(process.env.EVAL_MAX_K)
    : process.env.EVAL_ONLINEMIND2WEB_LIMIT
      ? Number(process.env.EVAL_ONLINEMIND2WEB_LIMIT)
      : 10;

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

  // Default to all skills if none specified
  const skillsToTest = skills || Object.keys(SKILL_CONFIGS);

  const allTestcases: Testcase[] = [];

  for (const skill of skillsToTest) {
    if (!SKILL_CONFIGS[skill]) {
      console.warn(`Skill "${skill}" not found, skipping`);
      continue;
    }

    for (const row of rows) {
      const input: EvalInput = {
        name: "agent/onlineMind2Web_skills_comparison",
        modelName: "claude-opus-4-5-20251101" as AvailableModel,
        params: {
          task_id: row.task_id,
          confirmed_task: row.confirmed_task,
          website: row.website,
          reference_length: row.reference_length,
          level: row.level,
          skill: skill,
        },
      };

      const taskCategories =
        tasksConfig.find((t) => t.name === input.name)?.categories || [];

      allTestcases.push({
        input,
        name: input.name,
        tags: [
          skill,
          "skills-comparison",
          "onlineMind2Web",
        ],
        metadata: {
          skill: skill,
          model: "claude-opus-4-5-20251101",
          test: `${input.name}:${row.task_id}:${skill}`,
          category: "skills_comparison",
          categories: [...taskCategories, "skills_comparison"],
          dataset: "onlineMind2Web",
          task_id: row.task_id,
          difficulty: row.level,
          website: row.website,
        },
        expected: true,
      });
    }
  }

  console.log(`Generated ${allTestcases.length} testcases`);

  return allTestcases;
};
