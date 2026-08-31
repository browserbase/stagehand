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
 * HardBenchmark — the residual hard core of WebTailBench + Online-Mind2Web.
 *
 * Both parent suites have saturated (74.8% of OM2W and 60% of WebTailBench are
 * passed by every frontier model we test), so their headline pass rates no
 * longer discriminate between models. This suite keeps only the tasks that
 * still do.
 *
 * Construction (see ~/.claude/plans/bench-bar-raising.html for the full audit):
 *   1. Take every task failed by BOTH frontier models (two frontier models on each
 *      parent suite) — 83 tasks.
 *   2. Audit each one against BOTH failing trajectories and classify the cause:
 *      genuine model fault / environment / verifier error / task invalid.
 *   3. Keep ONLY the genuine model faults, then drop any task carrying an
 *      absolute date (rot). Result: 46 tasks.
 *
 * Deliberately EXCLUDED, because they manufacture difficulty rather than
 * measure it — a hard benchmark made of broken tasks is worse than no benchmark:
 *   - environment lotteries (bot-walls / WAF / captcha: hilton_312,
 *     turkishairlines_11, lowes_6063, ...) — these measure Akamai, not the model
 *   - invalid rubrics (agwheelexpress_5 reads the rim SIZE "14 x 38" as an order
 *     QUANTITY of 14; extremerate_3 reads "3rd party" as three shell sets)
 *   - the purchase/don't-purchase contradiction, where the rubric pays for
 *     stopping before checkout but `outcomeSuccess` demands the purchase
 *     completed (kelty_2, petsmart_5650, overstock_9388)
 *   - date-rotted composite_* tasks whose bookings lie in the past
 *   - judge errors
 *
 * Rows carry their audited provenance (`failure_mode`, `capability_axis`,
 * `audit`) so a regression can be attributed to a capability, not just a task.
 * Each row's `precomputed_rubric` is lifted verbatim from the audited run, so
 * scoring is identical to the run the task was selected from.
 *
 * Expected pass rate at construction time: ~0%. That is the point — this suite
 * is all headroom.
 *
 * Validity is re-audited before each campaign by scripts/audit-hardbenchmark.ts
 * (live bot-wall probe, rubric shape, achievability vs. past runs). Rows it
 * quarantines carry `valid: false` + `invalid_reason` and are skipped here —
 * never deleted, so the quarantine is reviewable and reversible. Rows with
 * `verdict_review` are run but their verdicts need a manual look.
 *
 * Knobs (mirroring the parent suites):
 *   EVAL_MAX_K / EVAL_HARDBENCHMARK_LIMIT   cap the number of cases (default: all 46)
 *   EVAL_HARDBENCHMARK_SAMPLE               random sample of N
 *   EVAL_HARDBENCHMARK_IDS                  comma-separated ids, order preserved
 *   EVAL_HARDBENCHMARK_MODE                 filter by audited failure_mode
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
    [key: string]: unknown;
  };

  function isHardBenchmarkRow(parsed: unknown): parsed is HardBenchmarkRow {
    if (parsed === null || typeof parsed !== "object") return false;
    const obj = parsed as Record<string, unknown>;
    return typeof obj.id === "string" && typeof obj.ques === "string";
  }

  const allRows = parseJsonlRows(lines, isHardBenchmarkRow);
  const quarantined = allRows.filter((r) => r.valid === false);
  const candidates = allRows.filter((r) => r.valid !== false);
  if (quarantined.length > 0) {
    console.warn(
      `[hardbenchmark] skipping ${quarantined.length}/${allRows.length} quarantined task(s) (valid=false): ` +
        quarantined.map((r) => `${r.id} — ${r.invalid_reason ?? "no reason recorded"}`).join("; "),
    );
  }

  // Default to the WHOLE suite — it is only 46 tasks and every one of them
  // carries signal, so silently truncating to 25 (as the parent suites do)
  // would throw away half the headroom.
  const maxCases = process.env.EVAL_MAX_K
    ? Number(process.env.EVAL_MAX_K)
    : process.env.EVAL_HARDBENCHMARK_LIMIT
      ? Number(process.env.EVAL_HARDBENCHMARK_LIMIT)
      : candidates.length;
  const sampleCount = process.env.EVAL_HARDBENCHMARK_SAMPLE
    ? Number(process.env.EVAL_HARDBENCHMARK_SAMPLE)
    : undefined;

  const explicitIds = process.env.EVAL_HARDBENCHMARK_IDS
    ? process.env.EVAL_HARDBENCHMARK_IDS.split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : null;

  const modeFilter = process.env.EVAL_HARDBENCHMARK_MODE?.trim();

  let rows: HardBenchmarkRow[];
  if (explicitIds && explicitIds.length > 0) {
    const byId = new Map(candidates.map((r) => [r.id, r]));
    rows = explicitIds.map((id) => byId.get(id)).filter((r): r is HardBenchmarkRow => Boolean(r));
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
      const taskCategories = tasksConfig.find((t) => t.name === input.name)?.categories || [];
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
        },
        expected: true,
      });
    }
  }

  return allTestcases;
};
