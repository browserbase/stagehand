import fs from "node:fs";
import path from "node:path";
import type { AvailableModel } from "@browserbasehq/stagehand";
import type { AgentModelEntry, EvalInput, Testcase } from "../types/evals.js";
import { applySampling, normalizeAgentModelEntries } from "../utils.js";
import { getClawBenchCasesRoot } from "./paths.js";
import {
  resolveClawBenchModelName,
  loadClawBenchModelConfig,
  redactClawBenchModelConfig,
} from "./modelConfig.js";
import type {
  ClawBenchCase,
  ClawBenchExtraInfo,
  ClawBenchRunParams,
  ClawBenchTaskData,
} from "./types.js";

function caseId(casePath: string): number | null {
  const stem = path.basename(casePath).replace(/\.json$/, "");
  const match = /^(?:v\d+-|ce-)?[A-Za-z]?(\d+)/.exec(stem);
  return match ? Number(match[1]) : null;
}

function caseSortKey(casePath: string): [number, number, string] {
  const id = caseId(casePath);
  return id === null
    ? [1, Number.MAX_SAFE_INTEGER, path.basename(casePath)]
    : [0, id, path.basename(casePath)];
}

function compareCases(a: string, b: string): number {
  const ak = caseSortKey(a);
  const bk = caseSortKey(b);
  return ak[0] - bk[0] || ak[1] - bk[1] || ak[2].localeCompare(bk[2]);
}

function normalizeExtraInfo(raw: unknown): ClawBenchExtraInfo[] {
  if (!raw) return [];
  const entries = Array.isArray(raw) ? raw : [raw];
  return entries
    .map((entry): ClawBenchExtraInfo | null => {
      if (typeof entry === "string") {
        return entry.trim() ? { description: entry.trim() } : null;
      }
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return null;
      }
      const obj = entry as Record<string, unknown>;
      const description =
        typeof obj.description === "string"
          ? obj.description
          : typeof obj.note === "string"
            ? obj.note
            : "Additional task information";
      const normalized: ClawBenchExtraInfo = { description };
      if (typeof obj.path === "string" && obj.path) normalized.path = obj.path;
      return normalized;
    })
    .filter((entry): entry is ClawBenchExtraInfo => entry !== null);
}

function validateTask(task: unknown, filePath: string): ClawBenchTaskData {
  if (!task || typeof task !== "object" || Array.isArray(task)) {
    throw new Error(`${filePath} must contain a JSON object`);
  }
  const obj = task as Record<string, unknown>;
  if (typeof obj.instruction !== "string" || !obj.instruction.trim()) {
    throw new Error(`${filePath} is missing instruction`);
  }
  if (!obj.eval_schema || typeof obj.eval_schema !== "object") {
    throw new Error(`${filePath} is missing eval_schema`);
  }
  const schema = obj.eval_schema as Record<string, unknown>;
  if (typeof schema.url_pattern !== "string") {
    throw new Error(`${filePath} eval_schema.url_pattern must be a string`);
  }
  if (typeof schema.method !== "string") {
    throw new Error(`${filePath} eval_schema.method must be a string`);
  }
  if (typeof obj.time_limit !== "number") {
    throw new Error(`${filePath} time_limit must be a number`);
  }
  return obj as unknown as ClawBenchTaskData;
}

const SUPPORTED_CLAWBENCH_CORPUS = "v2";

function assertSupportedCorpus(corpus: string): void {
  if (corpus !== SUPPORTED_CLAWBENCH_CORPUS) {
    throw new Error(
      `Unsupported ClawBench corpus "${corpus}". Stagehand currently vendors and runs only ClawBench V2.`,
    );
  }
}

export function loadClawBenchCases(
  corpus = SUPPORTED_CLAWBENCH_CORPUS,
): ClawBenchCase[] {
  assertSupportedCorpus(corpus);
  const corpusDir = path.join(getClawBenchCasesRoot(), corpus);
  if (!fs.existsSync(corpusDir)) {
    throw new Error(`Unknown ClawBench corpus "${corpus}" at ${corpusDir}`);
  }

  const entries = fs.readdirSync(corpusDir, { withFileTypes: true });
  const taskFiles: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(corpusDir, entry.name);
    if (entry.isDirectory()) {
      const taskFile = path.join(fullPath, "task.json");
      if (fs.existsSync(taskFile)) taskFiles.push(taskFile);
    } else if (
      entry.isFile() &&
      entry.name.endsWith(".json") &&
      entry.name !== "eligibility-report.json"
    ) {
      taskFiles.push(fullPath);
    }
  }

  return taskFiles.sort(compareCases).map((taskFile) => {
    const task = validateTask(
      JSON.parse(fs.readFileSync(taskFile, "utf-8")),
      taskFile,
    );
    const taskDir = path.dirname(taskFile);
    return {
      corpus,
      caseName:
        path.basename(taskFile) === "task.json"
          ? path.basename(taskDir)
          : path.basename(taskFile, ".json"),
      taskFile,
      taskDir,
      task,
    };
  });
}

function parseCaseRange(raw?: string): [number, number] | undefined {
  if (!raw) return undefined;
  const match = /^(\d+)-(\d+)$/.exec(raw.trim());
  if (!match) throw new Error("EVAL_CLAWBENCH_CASE_RANGE must be START-END");
  const lo = Number(match[1]);
  const hi = Number(match[2]);
  if (lo > hi)
    throw new Error("EVAL_CLAWBENCH_CASE_RANGE start must be <= end");
  return [lo, hi];
}

function filterCases(cases: ClawBenchCase[]): ClawBenchCase[] {
  const wantedCases = (process.env.EVAL_CLAWBENCH_CASES ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const wanted = new Set(wantedCases);
  const range = parseCaseRange(process.env.EVAL_CLAWBENCH_CASE_RANGE);

  return cases.filter((testCase) => {
    if (wanted.size > 0) {
      const id = testCase.task.metadata?.task_id;
      return (
        wanted.has(testCase.caseName) ||
        (typeof id === "number" && wanted.has(String(id)))
      );
    }
    if (range) {
      const id = testCase.task.metadata?.task_id;
      return typeof id === "number" && id >= range[0] && id <= range[1];
    }
    return true;
  });
}

function maxCases(): number {
  if (process.env.EVAL_MAX_K) return Number(process.env.EVAL_MAX_K);
  if (process.env.EVAL_CLAWBENCH_LIMIT) {
    return Number(process.env.EVAL_CLAWBENCH_LIMIT);
  }
  return Number.MAX_SAFE_INTEGER;
}

function sampleCount(): number | undefined {
  return process.env.EVAL_CLAWBENCH_SAMPLE
    ? Number(process.env.EVAL_CLAWBENCH_SAMPLE)
    : undefined;
}

function buildParams(testCase: ClawBenchCase): ClawBenchRunParams {
  return {
    corpus: testCase.corpus,
    caseName: testCase.caseName,
    taskFile: testCase.taskFile,
    taskDir: testCase.taskDir,
    taskId: testCase.task.metadata?.task_id,
    instruction: testCase.task.instruction,
    evalSchema: testCase.task.eval_schema,
    timeLimitMinutes: testCase.task.time_limit,
    metadata: testCase.task.metadata,
    extraInfo: normalizeExtraInfo(testCase.task.extra_info),
    judgeContext: testCase.task.judge_context,
  };
}

export function buildClawBenchTestcases(
  models: string[] | AgentModelEntry[],
): Testcase[] {
  const corpus =
    process.env.EVAL_CLAWBENCH_CORPUS || SUPPORTED_CLAWBENCH_CORPUS;
  assertSupportedCorpus(corpus);
  const cases = applySampling(
    filterCases(loadClawBenchCases(corpus)),
    sampleCount(),
    maxCases(),
  );
  const modelEntries = normalizeAgentModelEntries(
    models.length > 0
      ? models
      : [
          {
            modelName: resolveClawBenchModelName(),
            mode: "hybrid",
            cua: false,
          },
        ],
  );

  const testcases: Testcase[] = [];
  for (const entry of modelEntries) {
    const modelConfig = loadClawBenchModelConfig(entry.modelName);
    for (const testCase of cases) {
      const params = buildParams(testCase);
      const input: EvalInput = {
        name: "agent/clawbench",
        modelName: entry.modelName as AvailableModel,
        agentMode: entry.mode,
        isCUA: entry.mode === "cua",
        params: {
          ...params,
          modelConfig: redactClawBenchModelConfig(modelConfig),
        },
      };

      testcases.push({
        input,
        name: input.name,
        tags: [
          entry.modelName,
          entry.mode,
          "clawbench",
          `clawbench/${corpus}`,
          `case/${testCase.caseName}`,
        ],
        metadata: {
          model: entry.modelName as AvailableModel,
          test: `${input.name}:${testCase.caseName}`,
          tier: "bench",
          task: input.name,
          category: "external_agent_benchmarks",
          categories: ["external_agent_benchmarks"],
          dataset: "clawbench",
          task_id:
            typeof params.taskId === "number"
              ? String(params.taskId)
              : testCase.caseName,
          website: params.metadata?.platform,
          difficulty:
            typeof params.metadata?.source_difficulty === "string"
              ? params.metadata.source_difficulty
              : undefined,
          task_category: params.metadata?.metaclass,
        },
        expected: true,
      });
    }
  }

  return testcases;
}
