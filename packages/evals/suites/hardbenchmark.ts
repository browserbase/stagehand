import type { Testcase, EvalInput, AgentModelEntry } from "../types/evals.js";
import { normalizeRubric, type AvailableModel } from "stagehand-v3";
import { tasksConfig } from "../taskConfig.js";
import { getPackageRootDir } from "../runtimePaths.js";
import {
  readJsonlFile,
  parseJsonlRows,
  applySampling,
  normalizeAgentModelEntries,
} from "../utils.js";

/**
 * HardBench corpus: core38, extended64, holdout20, retired33, quarantined3.
 * Default core; extended/all select102 valid non-holdout rows. Explicit IDs
 * or slugs select any valid row, including holdout, in the requested order.
 * See datasets/hardbenchmark/MANIFEST.md for selection and rubric v1.2.
 */
export const buildHardBenchmarkTestcases = (models: string[] | AgentModelEntry[]): Testcase[] => {
  const datasetPath = getPackageRootDir() + "/datasets/hardbenchmark/HardBenchmark_data.jsonl";

  const lines = readJsonlFile(datasetPath);

  type HardBenchmarkRow = {
    id: string;
    ques: string;
    category?: string;
    web?: string;
    precomputed_rubric?: unknown;
    /** Which parent suite the task came from: webtailbench | onlineMind2Web */
    source_suite?: string;
    /** Audited failure mode both frontier models exhibited. */
    failure_mode?: string;
    /** The capability the task actually probes. */
    capability_axis?: string;
    audit?: Record<string, unknown>;
    /** Set to false by scripts/audit-hardbenchmark.ts; quarantined rows stay in the file but never run. */
    valid?: boolean;
    invalid_reason?: string;
    /** Rubric rewards stopping before checkout while the wording says "purchase": verdicts need a manual look. */
    verdict_review?: string;
    /** core | extended | holdout | retired | quarantined (see MANIFEST.md). */
    set?: string;
    slug?: string;
    track?: "A" | "B";
    kind?: "pilot" | "variant";
    parent?: string;
    difficulty?: { depth: number; breadth: number; verification: number };
    rubric_version?: string;
    clarifications?: string[];
    environment_sensitive?: boolean;
    [key: string]: unknown;
  };
  type HardBenchmarkSet = "core" | "extended" | "holdout" | "all";

  function isHardBenchmarkRow(parsed: unknown): parsed is HardBenchmarkRow {
    if (parsed === null || typeof parsed !== "object") return false;
    const obj = parsed as Record<string, unknown>;
    return typeof obj.id === "string" && typeof obj.ques === "string";
  }

  const allRows = parseJsonlRows(lines, isHardBenchmarkRow);
  const quarantined = allRows.filter((r) => r.valid === false);
  const valid = allRows.filter((r) => r.valid !== false);
  if (quarantined.length > 0 && process.env.EVAL_HARDBENCHMARK_VERBOSE === "1") {
    console.warn(
      `[hardbenchmark] skipping ${quarantined.length}/${allRows.length} retired/quarantined task(s): ` +
        quarantined
          .map((r) => `${r.slug ?? r.id} — ${r.invalid_reason ?? "no reason recorded"}`)
          .join("; "),
    );
  }
  // Holdout is opt-in; retired/quarantined rows never enter the pool.
  const set = (process.env.EVAL_HARDBENCHMARK_SET?.trim() || "core") as HardBenchmarkSet;
  const setFilter: Record<HardBenchmarkSet, (row: HardBenchmarkRow) => boolean> = {
    core: (r) => (r.set ?? "core") === "core",
    extended: (r) => (r.set ?? "core") === "core" || r.set === "extended",
    holdout: (r) => r.set === "holdout",
    all: (r) => r.set !== "holdout",
  };
  if (!Object.hasOwn(setFilter, set)) {
    throw new Error(
      `EVAL_HARDBENCHMARK_SET must be one of core | extended | holdout | all (got "${set}").`,
    );
  }
  const candidates = valid.filter(setFilter[set]);

  const positiveInteger = (key: string): number | undefined => {
    const raw = process.env[key];
    if (raw === undefined) return undefined;
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`${key} must be a positive integer (got "${raw}").`);
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

  const modeFilter = process.env.EVAL_HARDBENCHMARK_MODE?.trim();

  let rows: HardBenchmarkRow[];
  if (explicitIds && explicitIds.length > 0) {
    const byId = new Map<string, HardBenchmarkRow>();
    for (const r of valid) {
      byId.set(r.id, r);
      if (r.slug) byId.set(r.slug, r);
    }
    const seen = new Set<string>();
    rows = explicitIds.map((id) => {
      const row = byId.get(id);
      if (!row) throw new Error(`Unknown or inactive HardBench task ID/slug: "${id}".`);
      if (seen.has(row.id)) throw new Error(`Duplicate HardBench task: "${row.id}".`);
      seen.add(row.id);
      return row;
    });
  } else {
    const pool = modeFilter ? candidates.filter((r) => r.failure_mode === modeFilter) : candidates;
    rows = applySampling(pool, sampleCount, maxCases);
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
          // audited provenance — lets a regression be attributed to a capability
          source_suite: row.source_suite,
          failure_mode: row.failure_mode,
          capability_axis: row.capability_axis,
          ...(row.verdict_review ? { verdict_review: row.verdict_review } : {}),
          ...(row.slug ? { slug: row.slug } : {}),
          ...(row.track ? { track: row.track } : {}),
          ...(row.kind ? { kind: row.kind } : {}),
          ...(row.parent ? { parent: row.parent } : {}),
          ...(row.difficulty
            ? {
                difficulty: `d${row.difficulty.depth}b${row.difficulty.breadth}v${row.difficulty.verification}`,
              }
            : {}),
          bench_tier: row.set ?? "core",
          rubric_version: row.rubric_version,
          clarifications: row.clarifications,
          environment_sensitive: row.environment_sensitive,
        },
        expected: true,
      });
    }
  }

  return allTestcases;
};
