import type { Testcase, EvalInput, AgentModelEntry } from "../types/evals.js";
import { EvalsError } from "../errors.js";
import { normalizeRubric, type AvailableModel } from "stagehand-v3";
import { tasksConfig } from "../taskConfig.js";
import { getPackageRootDir } from "../runtimePaths.js";
import {
  readJsonlFile,
  parseJsonlRows,
  applySampling,
  normalizeAgentModelEntries,
} from "../utils.js";

/** Core is the default; extended includes all shipped tasks. */
export const buildHardBenchmarkTestcases = (models: string[] | AgentModelEntry[]): Testcase[] => {
  const datasetPath = getPackageRootDir() + "/datasets/hardbenchmark/HardBenchmark_data.jsonl";

  const lines = readJsonlFile(datasetPath);

  type HardBenchmarkRow = {
    id: string;
    ques: string;
    category?: string;
    web?: string;
    precomputed_rubric?: unknown;
    set: "core" | "extended";
    slug?: string;
    rubric_version?: string;
    clarifications?: string[];
  };
  type HardBenchmarkSet = HardBenchmarkRow["set"];

  function isHardBenchmarkRow(parsed: unknown): parsed is HardBenchmarkRow {
    if (parsed === null || typeof parsed !== "object") return false;
    const obj = parsed as Record<string, unknown>;
    return typeof obj.id === "string" && typeof obj.ques === "string";
  }

  const allRows = parseJsonlRows(lines, isHardBenchmarkRow);
  const set = (process.env.EVAL_HARDBENCHMARK_SET?.trim() || "core") as HardBenchmarkSet;
  const setFilter: Record<HardBenchmarkSet, (row: HardBenchmarkRow) => boolean> = {
    core: (r) => r.set === "core",
    extended: (r) => r.set === "core" || r.set === "extended",
  };
  if (!Object.hasOwn(setFilter, set)) {
    throw new EvalsError("EVAL_HARDBENCHMARK_SET must be one of core | extended.");
  }
  const candidates = allRows.filter(setFilter[set]);

  const positiveInteger = (key: string): number | undefined => {
    const raw = process.env[key];
    if (raw === undefined) return undefined;
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new EvalsError(`${key} must be a positive integer.`);
    }
    return value;
  };
  const maxCases =
    positiveInteger("EVAL_MAX_K") ??
    positiveInteger("EVAL_HARDBENCHMARK_LIMIT") ??
    candidates.length;
  const sampleCount = positiveInteger("EVAL_HARDBENCHMARK_SAMPLE");

  const explicitIds = process.env.EVAL_HARDBENCHMARK_IDS
    ? process.env.EVAL_HARDBENCHMARK_IDS.split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : null;

  let rows: HardBenchmarkRow[];
  if (explicitIds && explicitIds.length > 0) {
    const byId = new Map<string, HardBenchmarkRow>();
    for (const r of allRows) {
      byId.set(r.id, r);
      if (r.slug) byId.set(r.slug, r);
    }
    const seen = new Set<string>();
    rows = explicitIds.map((id) => {
      const row = byId.get(id);
      if (!row) throw new EvalsError("Unknown HardBench task ID or slug.");
      if (seen.has(row.id)) throw new EvalsError("Duplicate HardBench task selection.");
      seen.add(row.id);
      return row;
    });
  } else {
    rows = applySampling(
      candidates,
      sampleCount === undefined ? undefined : Math.min(sampleCount, maxCases),
      maxCases,
    );
  }

  const allTestcases: Testcase[] = [];
  for (const modelEntry of normalizeAgentModelEntries(models)) {
    for (const row of rows) {
      const input: EvalInput = {
        name: "agent/hardbenchmark",
        modelName: modelEntry.modelName as AvailableModel,
        agentMode: modelEntry.mode,
        isCUA: modelEntry.mode === "cua",
        params: {
          id: row.id,
          category: row.category,
          ques: row.ques,
          web: row.web,
          precomputed_rubric: normalizeRubric(row.precomputed_rubric),
        },
      };
      const taskCategories = tasksConfig.find((t) => t.name === input.name)?.categories ?? [
        "external_agent_benchmarks",
      ];
      allTestcases.push({
        input,
        name: input.name,
        tags: [modelEntry.modelName, modelEntry.mode, "hardbenchmark"],
        metadata: {
          model: modelEntry.modelName as AvailableModel,
          test: `${input.name}:${row.id}`,
          tier: "bench",
          task: input.name,
          category: taskCategories[0] || "agent",
          categories: taskCategories,
          dataset: "hardbenchmark",
          task_id: row.id,
          task_category: row.category,
          ...(row.slug ? { slug: row.slug } : {}),
          bench_tier: row.set,
          rubric_version: row.rubric_version,
          clarifications: row.clarifications,
        },
        expected: true,
      });
    }
  }

  return allTestcases;
};
