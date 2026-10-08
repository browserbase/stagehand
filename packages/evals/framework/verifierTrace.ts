import fs from "node:fs/promises";
import path from "node:path";
import type { LogLine } from "stagehand-v3";
import { sanitizeErrorMessage } from "@browserbasehq/stagehand-integrations/harness";

type TraceLine = LogLine & { parsedAuxiliary?: unknown };

/**
 * Full verifier trace (EVAL_VERIFIER_TRACE=1). The v3 evaluator itself logs
 * only failures, but its LLM client logs every request and response at
 * level 2 (category "aisdk"): the batchedRelevance prompt with each evidence
 * item, the top-K selection the judge actually reads, and the fusedJudgment
 * response. With the switch on, the verifier carrier runs at verbose 2 and
 * the grading-phase lines are written to scores/verifier-trace.jsonl instead
 * of the row logs (they are megabytes per task).
 */
export const VERIFIER_TRACE_ENV = "EVAL_VERIFIER_TRACE";
export const VERIFIER_TRACE_FILE = "verifier-trace.jsonl";
const TRACE_CATEGORIES = new Set(["aisdk", "AISDK error", "verifier", "llm", "flow"]);

export function verifierTraceEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env[VERIFIER_TRACE_ENV]?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/** Grading-phase lines worth keeping: the judge's LLM traffic and verifier notes. */
export function selectVerifierTraceLines(
  linesAfter: TraceLine[],
  countBefore: number,
): TraceLine[] {
  return linesAfter
    .slice(countBefore)
    .filter((line) => TRACE_CATEGORIES.has(String(line.category ?? "")));
}

export function validateVerifierLabel(label: string | undefined): void {
  if (label !== undefined && (/[\\/\0]/u.test(label) || label === "." || label === "..")) {
    throw new Error("Verifier label must be a single filename component without path separators.");
  }
}

export async function writeVerifierTrace(
  trajectoryDir: string,
  lines: TraceLine[],
  label?: string,
): Promise<string | undefined> {
  validateVerifierLabel(label);
  if (lines.length === 0) return undefined;
  const file = path.join(
    trajectoryDir,
    "scores",
    label ? `verifier-trace_${label}.jsonl` : VERIFIER_TRACE_FILE,
  );
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
    return file;
  } catch (error) {
    console.warn(
      sanitizeErrorMessage(
        `Could not write verifier trace ${file}: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
    return undefined;
  }
}
