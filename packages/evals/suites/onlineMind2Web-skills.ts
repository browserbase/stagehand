import { Testcase } from "../types/evals";
import { SKILL_CONFIGS, getAvailableSkills } from "../lib/skillAgents";
import * as fs from "fs";
import * as path from "path";
import type { AvailableModel } from "@browserbasehq/stagehand";

interface Mind2WebRow {
  task_id: string;
  confirmed_task: string;
  website: string;
  level: string;
}

export function buildOnlineMind2WebSkillsTestcases(skillsFilter?: string[]): Testcase[] {
  // Load dataset
  const datasetPath = path.resolve(__dirname, "../datasets/onlineMind2Web/onlineMind2Web.jsonl");
  const data = fs.readFileSync(datasetPath, "utf-8");
  const rows: Mind2WebRow[] = data
    .split("\n")
    .filter((line) => line.trim() && !line.startsWith("//"))
    .map((line) => JSON.parse(line));

  // Get skills to test from filter or env var or use all available
  const skills = skillsFilter ?? (process.env.EVAL_SKILLS
    ? process.env.EVAL_SKILLS.split(",").map((s) => s.trim())
    : getAvailableSkills());

  // Limit number of tasks from env var
  const maxK = parseInt(process.env.EVAL_MAX_K || "10", 10);
  const limitedRows = rows.slice(0, maxK);

  console.log(`Generating testcases for ${skills.length} skills x ${limitedRows.length} tasks`);

  // Generate test cases: one per skill x task combination
  const testcases: Testcase[] = [];
  const modelName: AvailableModel = "claude-sonnet-4-5-20250929";

  for (const row of limitedRows) {
    for (const skill of skills) {
      // Verify skill exists
      if (!SKILL_CONFIGS[skill]) {
        console.warn(`Unknown skill: ${skill}, skipping`);
        continue;
      }

      const taskName = "agent/onlineMind2Web_skills_comparison";
      testcases.push({
        input: {
          name: taskName,
          modelName,
          params: {
            skill,
            task: row.confirmed_task,
            website: row.website,
            task_id: row.task_id,
            difficulty: row.level,
          },
        },
        name: taskName,
        tags: [
          modelName,
          taskName,
          skill,
          `skill:${skill}`,
          `difficulty:${row.level}`,
          `task_id:${row.task_id}`,
        ],
        expected: true,
        metadata: {
          model: modelName,
          test: `${taskName}:${row.task_id}:${skill}`,
          categories: ["skills_comparison", row.level],
          skill,
          task_id: row.task_id,
          difficulty: row.level,
          website: row.website,
        },
      });
    }
  }

  console.log(`Generated ${testcases.length} testcases`);
  return testcases;
}
