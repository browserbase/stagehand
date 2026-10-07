/**
 * Per-task requirement checklists (amortized): decompose a task + rubric into atomic, verifiable
 * requirements ONCE per task (cached on disk by content hash), then have the single judgment call
 * verify each requirement against recorded evidence. The checklist costs one LLM call per task/rubric
 * version, not per run, so per-run call count is unchanged.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import type { LLMClient, LLMParsedResponse, LogLine } from "./client.js";
import type { Rubric, TaskSpec } from "./types.js";

export const REQUIREMENTS_PROMPT_VERSION = "req-v1";

export const RequirementSchema = z.object({
  id: z.string().describe("R1, R2, ..."),
  requirement: z
    .string()
    .describe(
      "One atomic requirement on the FINAL result, qualifiers quoted verbatim from the task/rubric",
    ),
  kind: z.enum(["constraint", "datum", "deliverable", "boundary"]),
  how_to_verify: z
    .string()
    .describe(
      "Which recorded observation would confirm or refute it (URL parameter, widget value, product-page attribute, cart line, final-answer field)",
    ),
});
export const ChecklistSchema = z.object({
  requirements: z.array(RequirementSchema).min(1).max(20),
});
export type Checklist = z.infer<typeof ChecklistSchema>;

export const RequirementVerdictSchema = z.object({
  id: z.string(),
  state: z.enum(["supported", "contradicted", "unresolved", "not_applicable"]),
  evidence: z
    .string()
    .describe(
      "Cite step/evidence IDs or the final answer; for contradicted, quote the conflicting observation",
    ),
});
export type RequirementVerdict = z.infer<typeof RequirementVerdictSchema>;

const PROMPT = `Decompose this browser task and its grading rubric into atomic, independently verifiable requirements on the FINAL result.
Include: every explicit constraint (dates, times, guests, nights, sizes, locations/ZIP, filters, sort, price bounds, vehicle or item type, required source site);
every datum, field, candidate, or row the final answer must contain; the stopping boundary (what must not be submitted or entered); and any required format.
Quote qualifiers verbatim. Exclude process steps (navigation, searching) unless the task requires a specific final state.
Where the rubric allows a disclosed fallback for an unavailable item, state the requirement together with its fallback.
Return 4-15 requirements.`;

const inflight = new Map<string, Promise<Checklist | undefined>>();

export function checklistCacheKey(task: TaskSpec, rubric: Rubric): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        v: REQUIREMENTS_PROMPT_VERSION,
        id: task.id,
        instruction: task.instruction,
        rubric,
      }),
    )
    .digest("hex")
    .slice(0, 24);
}

export async function loadOrGenerateChecklist(args: {
  client: LLMClient;
  logger: (line: LogLine) => void;
  task: TaskSpec;
  rubric: Rubric;
  cacheDir?: string;
}): Promise<Checklist | undefined> {
  const dir =
    args.cacheDir ??
    process.env.VERIFIER_REQUIREMENTS_CACHE_DIR ??
    path.join(os.homedir(), ".cache", "stagehand-evaluator", "requirements");
  const key = checklistCacheKey(args.task, args.rubric);
  const file = path.join(dir, `${key}.json`);
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = (async () => {
    try {
      return ChecklistSchema.parse(JSON.parse(await fs.readFile(file, "utf8")));
    } catch {
      /* not cached */
    }
    try {
      const res = await args.client.createChatCompletion<LLMParsedResponse<Checklist>>({
        logger: args.logger,
        options: {
          messages: [
            {
              role: "system",
              content:
                "You write precise grading checklists. Output only JSON matching the schema.",
            },
            {
              role: "user",
              content: `${PROMPT}\n\nTASK:\n${args.task.instruction}\n\nRUBRIC:\n${JSON.stringify(args.rubric, null, 1)}`,
            },
          ],
          response_model: { name: "RequirementChecklist", schema: ChecklistSchema },
        },
      });
      const checklist = ChecklistSchema.parse(res.data);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        file,
        JSON.stringify({ ...checklist, _key: key, _task: args.task.id }, null, 1),
      );
      return checklist;
    } catch (error) {
      args.logger({
        category: "verifier",
        level: 1,
        message: `requirement checklist unavailable: ${error instanceof Error ? error.message : String(error)}`,
      });
      return undefined;
    }
  })();
  inflight.set(key, p);
  return p;
}

export function renderChecklist(checklist: Checklist | undefined): string {
  if (!checklist) return "";
  const lines = checklist.requirements.map(
    (r) => `- ${r.id} [${r.kind}] ${r.requirement} — verify by: ${r.how_to_verify}`,
  );
  return `\n\n**Requirement checklist (precomputed for this task).** Verify EACH requirement against recorded observations and the actual final answer, and return outcome.requirements with one entry per id: supported (an observation or the final answer establishes it), contradicted (an observation shows a different value/state — e.g. a URL parameter, widget value, or page attribute that conflicts, or a required item missing from the final answer), unresolved (no observation either way), or not_applicable (a rubric fallback clause covers it). The agent's narration is not an observation.\n${lines.join("\n")}`;
}

/** Any contradicted requirement makes the outcome contradicted. Unresolved requirements do not block on their own. */
export function requirementsContradicted(verdicts: RequirementVerdict[] | undefined): boolean {
  return (verdicts ?? []).some((v) => v.state === "contradicted");
}
