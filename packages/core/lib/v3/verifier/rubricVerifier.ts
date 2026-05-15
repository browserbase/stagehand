/**
 * RubricVerifier — rubric-based verification pipeline.
 *
 * Runs rubric generation, evidence selection, per-criterion scoring, outcome
 * verification, failure analysis, and task-validity checks over a saved
 * trajectory.
 *
 * Architectural invariants:
 *   - Verifier never touches a live browser. Pure (Trajectory, TaskSpec) → EvaluationResult.
 *   - Public surface is V3Evaluator.verify(). This class stays internal.
 *
 * The class accepts a small ClientFactory so V3Evaluator can inject its
 * existing LLM client without RubricVerifier needing a V3 handle.
 */
import { z } from "zod";

import type { LLMClient, LLMResponse } from "../llm/LLMClient.js";
import type { LLMParsedResponse } from "../../inference.js";
import type { LogLine } from "../types/public/logs.js";

import type {
  CanonicalEvidence,
  CanonicalScreenshot,
  CanonicalTextEvidence,
  CriterionScore,
  EvaluationResult,
  EvidenceLoadResult,
  Rubric,
  RubricVerifierOptions,
  TaskSpec,
  Trajectory,
  Verifier,
} from "./types.js";
import { normalizeRubric } from "./trajectory.js";
import {
  FIRST_POINT_OF_FAILURE_PROMPT,
  FUSED_JUDGMENT_PROMPT,
  FUSED_OUTCOME_PROMPT,
  MM_BATCHED_RELEVANCE_PROMPT,
  MM_PER_CRITERION_SCORE_PROMPT,
  RUBRIC_GENERATION_PROMPT,
  TASK_VALIDITY_PROMPT,
  buildInitUrlContext,
  parseFailureStepNumbers,
  renderPrompt,
} from "./prompts/index.js";
import {
  collectCanonicalEvidence,
  isImageEvidence,
  isTextEvidence,
} from "./evidence.js";
import { getTaxonomyText } from "./errorTaxonomy.js";

const RubricItemSchema = z.object({
  criterion: z.string(),
  description: z.string(),
  max_points: z.number(),
  condition: z.string().optional(),
  justification: z.string().optional(),
  earned_points: z.union([z.number(), z.string()]).optional(),
});

const RubricSchema = z.object({
  items: z.array(RubricItemSchema),
});

const FindingSchema = z.object({
  category: z
    .enum([
      "agent_tool_usage",
      "agent_strategy",
      "rubric_quality",
      "trajectory_capture",
      "task_specification",
      "verifier_uncertainty",
      "other",
    ])
    .catch("other"),
  severity: z.enum(["info", "warning", "blocking"]).catch("info"),
  description: z.string(),
  suggestedAction: z.string().optional(),
  relatedSteps: z.array(z.number()).optional(),
});

const OutcomeSchema = z.object({
  primary_intent: z.string(),
  reasoning: z.string(),
  output_success: z.boolean(),
  findings: z.array(FindingSchema).optional().default([]),
});

// ── New (overwriting) pipeline schemas ─────────────────────────────────────

/** Approach B's fused-judgment response schema. */
const FusedFindingSchema = z.object({
  category: z
    .enum([
      "agent_tool_usage",
      "agent_strategy",
      "rubric_quality",
      "trajectory_capture",
      "task_specification",
      "verifier_uncertainty",
      "other",
    ])
    .catch("other"),
  severity: z.enum(["info", "warning", "blocking"]).catch("info"),
  description: z.string(),
  suggestedAction: z.string().optional(),
  relatedSteps: z.array(z.number()).optional(),
});

const FusedOutcomeSchema = z.object({
  primary_intent: z.string(),
  reasoning: z.string(),
  output_success: z.boolean(),
  findings: z.array(FusedFindingSchema).optional().default([]),
});

const FusedPerCriterionSchema = z.object({
  criterion_idx: z.coerce.number().int().min(0),
  applicable_evidence: z.string().optional().default(""),
  justification: z.string().optional().default(""),
  earned_points: z.coerce.number(),
  evidence_sufficient: z.boolean().optional().default(true),
  condition_met: z.boolean().nullable().optional(),
});

const FusedFailurePointSchema = z.object({
  step_index: z.coerce.number().int(),
  error_code: z.string(),
  error_category: z.string(),
  description: z.string(),
});

const FusedTaskValiditySchema = z.object({
  is_ambiguous: z.boolean(),
  ambiguity_reason: z.string().optional().default(""),
  is_invalid: z.boolean(),
  invalid_reason: z.string().optional().default(""),
});

const FusedJudgmentResponseSchema = z.object({
  outcome: FusedOutcomeSchema,
  per_criterion: z.array(FusedPerCriterionSchema),
  failure_point: FusedFailurePointSchema.optional(),
  task_validity: FusedTaskValiditySchema.optional(),
});

/** Approach A's outcome call — no per_criterion in response. */
const FusedOutcomeResponseSchema = z.object({
  outcome: FusedOutcomeSchema,
  failure_point: FusedFailurePointSchema.optional(),
  task_validity: FusedTaskValiditySchema.optional(),
});

/** Batched relevance — Step 2 replacement. */
const BatchedRelevanceItemSchema = z.object({
  evidence_idx: z.coerce.number().int().min(0),
  scores: z.array(
    z.object({
      criterion_idx: z.coerce.number().int().min(0),
      score: z.coerce.number().int().min(0).max(10),
    }),
  ),
});
const BatchedRelevanceResponseSchema = z.object({
  items: z.array(BatchedRelevanceItemSchema),
});

/** Per-criterion scoring — Approach A's analysis+score call. */
const PerCriterionScoreResponseSchema = z.object({
  criterion_idx: z.coerce.number().int().min(0),
  applicable_evidence: z.string().optional().default(""),
  justification: z.string().optional().default(""),
  earned_points: z.coerce.number(),
  evidence_sufficient: z.boolean().optional().default(true),
  condition_met: z.boolean().nullable().optional(),
});

const TaskValiditySchema = z.object({
  reasoning_is_ambiguous: z.string(),
  is_ambiguous: z.boolean(),
  ambiguity_codes: z.array(z.string()).default([]),
  reasoning_is_invalid: z.string(),
  is_invalid: z.boolean(),
  invalid_task_codes: z.array(z.string()).default([]),
});

const FailurePointSchema = z.object({
  step_numbers: z.string(),
  error_code: z.string(),
  error_category: z.string(),
  error_type: z.string(),
  what_happened: z.string(),
  agent_reasoning: z.string(),
  evidence: z.string(),
  impact: z.string(),
});

const FailureAnalysisSchema = z.object({
  reasoning: z.string(),
  has_failure: z.boolean(),
  failure_points: z.array(FailurePointSchema).default([]),
});

const noopLogger: (line: LogLine) => void = () => {};
const APPROX_CHARS_PER_TOKEN = 4;
const DEFAULT_ACTION_HISTORY_TOKEN_BUDGET = 2_000;
const DEFAULT_EVIDENCE_TOKEN_BUDGET = 3_000;
const DEFAULT_OUTCOME_IMAGE_LIMIT = 3;
const DEFAULT_MAX_PARALLEL = 8;
const DEFAULT_TOP_K = 5;
const DEFAULT_RELEVANCE_BATCH_SIZE = 4;
const DEFAULT_APPROACH: "a" | "b" = "b";
type OptionalStepsMode = "folded" | "separate" | "skip";
const DEFAULT_OPTIONAL_STEPS_MODE: OptionalStepsMode = "folded";
const EVIDENCE_TEXT_PREVIEW_CHARS = 200;

// ─── Standalone helpers used by the new pipeline ───────────────────────────

function readApproach(): "a" | "b" {
  const raw = process.env.VERIFIER_APPROACH;
  if (raw === "a" || raw === "b") return raw;
  return DEFAULT_APPROACH;
}

function readOptionalsMode(): OptionalStepsMode {
  const raw = process.env.VERIFIER_OPTIONAL_STEPS;
  if (raw === "folded" || raw === "separate" || raw === "skip") return raw;
  return DEFAULT_OPTIONAL_STEPS_MODE;
}

/** Top-K grouping per criterion. Pure compute. */
function groupTopKByCriterion(args: {
  numCriteria: number;
  relevanceScores: Map<number, Map<number, number>>;
  topK: number;
}): Map<number, number[]> {
  const { numCriteria, relevanceScores, topK } = args;
  const grouped = new Map<number, number[]>();

  for (let cIdx = 0; cIdx < numCriteria; cIdx++) {
    const scored: Array<{ eIdx: number; score: number }> = [];
    for (const [eIdx, scoreMap] of relevanceScores.entries()) {
      scored.push({ eIdx, score: scoreMap.get(cIdx) ?? 0 });
    }
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.eIdx - b.eIdx; // ties → chronological order
    });

    const topKEvidence = scored.slice(0, topK);

    // Relevance-floor filter: if any selected evidence scored ≥6,
    // drop low-relevance entries that are >2 points below the weakest
    // high-relevance entry.
    const highScores = topKEvidence
      .filter((s) => s.score >= 6)
      .map((s) => s.score);
    if (highScores.length === 0) {
      grouped.set(
        cIdx,
        topKEvidence.map((s) => s.eIdx),
      );
      continue;
    }
    const minHigh = Math.min(...highScores);
    const kept = topKEvidence.filter(
      (s) => !(s.score < 5 && minHigh - s.score > 2),
    );
    grouped.set(
      cIdx,
      (kept.length > 0 ? kept : topKEvidence).map((s) => s.eIdx),
    );
  }
  return grouped;
}

function mapFusedPerCriterionToScores(
  rubric: Rubric,
  perCriterion: z.infer<typeof FusedPerCriterionSchema>[],
): CriterionScore[] {
  const byIdx = new Map<number, z.infer<typeof FusedPerCriterionSchema>>();
  for (const entry of perCriterion) byIdx.set(entry.criterion_idx, entry);

  return rubric.items.map((c, i): CriterionScore => {
    const entry = byIdx.get(i);
    if (!entry) {
      return {
        criterion: c.criterion,
        maxPoints: c.maxPoints,
        earnedPoints: null,
        explanation: "Verifier did not return a score for this criterion.",
        evidenceInsufficient: true,
      };
    }
    const clamped = Math.max(0, Math.min(c.maxPoints, entry.earned_points));
    return {
      criterion: c.criterion,
      maxPoints: c.maxPoints,
      earnedPoints: clamped,
      explanation: entry.justification,
      evidenceInsufficient: entry.evidence_sufficient === false,
    };
  });
}

function evidencePreview(point: CanonicalEvidence): string {
  if (isImageEvidence(point)) {
    return `Screenshot at step ${point.originalStepIndex} (${point.bytes.length} bytes, ${point.mediaType})`;
  }
  const preview = point.content.slice(0, EVIDENCE_TEXT_PREVIEW_CHARS);
  return `${textEvidenceLabel(point)} at step ${point.originalStepIndex} — "${preview.replace(/\s+/g, " ")}${point.content.length > EVIDENCE_TEXT_PREVIEW_CHARS ? "…" : ""}"`;
}

function textEvidenceLabel(point: CanonicalTextEvidence): string {
  switch (point.source) {
    case "probe-aria":
      return "ariaTree";
    case "agent-text":
      return "agent text";
    case "agent-json":
      return "agent JSON";
    case "tool-output":
      return "tool output";
  }
}

function renderEvidenceManifest(points: CanonicalEvidence[]): string {
  if (points.length === 0) return "(no evidence captured)";
  return points
    .map((p) => `- evidence_idx=${p.canonicalIndex}: ${evidencePreview(p)}`)
    .join("\n");
}

function renderGroupedEvidenceForApproach(
  rubric: Rubric,
  evidence: CanonicalEvidence[],
  groupedTopK: Map<number, number[]>,
): string {
  if (evidence.length === 0) return "(no evidence captured)";
  const byIdx = new Map<number, CanonicalEvidence>();
  for (const e of evidence) byIdx.set(e.canonicalIndex, e);

  const sections: string[] = [];
  for (let cIdx = 0; cIdx < rubric.items.length; cIdx++) {
    const c = rubric.items[cIdx];
    const topK = groupedTopK.get(cIdx) ?? [];
    if (topK.length === 0) {
      sections.push(
        `### Criterion ${cIdx}: ${c.criterion}\n(no evidence scored highly enough — rely on action history)`,
      );
      continue;
    }
    const body = topK
      .map((eIdx) => {
        const p = byIdx.get(eIdx);
        if (!p) return null;
        if (isImageEvidence(p)) {
          return `- Evidence #${eIdx} — image @ step=${p.originalStepIndex}`;
        }
        const text = p.content.replace(/\s+/g, " ").slice(0, 600);
        return `- Evidence #${eIdx} — ${textEvidenceLabel(p)} @ step=${p.originalStepIndex}: "${text}${p.content.length > 600 ? "…" : ""}"`;
      })
      .filter((x): x is string => x !== null)
      .join("\n");
    sections.push(`### Criterion ${cIdx}: ${c.criterion}\n${body}`);
  }
  return sections.join("\n\n");
}

export class RubricVerifier implements Verifier {
  private readonly getClient: () => LLMClient;
  private readonly logger: (line: LogLine) => void;

  constructor(opts: RubricVerifierOptions) {
    this.getClient = opts.getClient;
    this.logger = opts.logger ?? noopLogger;
  }

  async verify(
    trajectory: Trajectory,
    taskSpec: TaskSpec,
  ): Promise<EvaluationResult> {
    const hasTrajectorySignal =
      trajectory.steps.length > 0 || Boolean(trajectory.finalAnswer?.trim());
    if (!hasTrajectorySignal) {
      return this.emptyTrajectoryResult(
        normalizeRubric(taskSpec.precomputedRubric),
      );
    }

    // Step 0a — generate rubric if absent.
    let rubric: Rubric | undefined = normalizeRubric(taskSpec.precomputedRubric);
    const rubricSource = rubric ? "precomputed" : "generated";
    if (!rubric) {
      rubric = await this.generateRubric(taskSpec);
    }

    const approach = readApproach();
    const optionalsMode = readOptionalsMode();

    // ── Steps 1–3: collect evidence, batched relevance, top-K ──────────────
    // Combined images + ariaTree text evidence → single relevance matrix →
    // per-criterion top-K selection. Empty-evidence trajectories fall back
    // gracefully (the chosen approach degrades to an action-history-only
    // judgment).
    const { evidence, loaded } = await collectCanonicalEvidence(trajectory);

    const relevanceScores = await this.scoreRelevanceBatched({
      taskSpec,
      rubric,
      evidence,
    });

    const groupedTopK = groupTopKByCriterion({
      numCriteria: rubric.items.length,
      relevanceScores,
      topK: readPositiveIntEnv("VERIFIER_TOP_K", DEFAULT_TOP_K),
    });

    // ── Per-criterion scoring (Approach A) or fused judgment (Approach B) ──
    let perCriterion: CriterionScore[];
    let fusedOutcome: z.infer<typeof FusedOutcomeSchema> | undefined;
    let foldedFailurePoint: z.infer<typeof FusedFailurePointSchema> | undefined;
    let foldedTaskValidity: z.infer<typeof FusedTaskValiditySchema> | undefined;

    if (approach === "b") {
      const fused = await this.fusedJudgment({
        trajectory,
        taskSpec,
        rubric,
        evidence,
        groupedTopK,
        foldFailure: optionalsMode === "folded",
        foldValidity: optionalsMode === "folded",
      });
      perCriterion = mapFusedPerCriterionToScores(rubric, fused.per_criterion);
      fusedOutcome = fused.outcome;
      foldedFailurePoint = fused.failure_point;
      foldedTaskValidity = fused.task_validity;
    } else {
      // Approach A: per-criterion analysis returns earned_points; no
      // separate whole-rubric rescore.
      perCriterion = await this.scorePerCriterion({
        trajectory,
        taskSpec,
        rubric,
        evidence,
        groupedTopK,
      });

      const outcome = await this.verifyOutcomeFused({
        trajectory,
        taskSpec,
        rubric,
        perCriterion,
        evidence,
        foldFailure: optionalsMode === "folded",
        foldValidity: optionalsMode === "folded",
      });
      fusedOutcome = outcome.outcome;
      foldedFailurePoint = outcome.failure_point;
      foldedTaskValidity = outcome.task_validity;
    }

    // ── Process score (deterministic from earned_points) ──────────────────
    const totals = perCriterion.reduce(
      (acc, c) => ({
        earned: acc.earned + (c.earnedPoints ?? 0),
        max: acc.max + c.maxPoints,
      }),
      { earned: 0, max: 0 },
    );
    const processScore = totals.max > 0 ? totals.earned / totals.max : 0;

    const evidenceInsufficient = perCriterion
      .filter((c) => c.evidenceInsufficient)
      .map((c) => c.criterion);

    const findings = (fusedOutcome?.findings ?? []).map((f) => ({
      ...f,
      category: f.category ?? ("other" as const),
      severity: f.severity ?? ("info" as const),
    }));

    // ── Optional steps: folded, separate, or skipped ──────────────────────
    let firstPointOfFailure: EvaluationResult["firstPointOfFailure"];
    if (foldedFailurePoint && !fusedOutcome?.output_success) {
      firstPointOfFailure = {
        stepIndex: foldedFailurePoint.step_index,
        errorCode: foldedFailurePoint.error_code,
        category: foldedFailurePoint.error_category,
        description: foldedFailurePoint.description,
      };
    } else if (
      optionalsMode === "separate" &&
      fusedOutcome &&
      !fusedOutcome.output_success
    ) {
      firstPointOfFailure = await this.analyzeFailures({
        trajectory,
        taskSpec,
        rubric,
        perCriterion,
        outcome: {
          output_success: fusedOutcome.output_success,
          primary_intent: fusedOutcome.primary_intent,
          reasoning: fusedOutcome.reasoning,
          findings: fusedOutcome.findings ?? [],
        },
      }).catch((): EvaluationResult["firstPointOfFailure"] => undefined);
    }

    let taskValidity: EvaluationResult["taskValidity"];
    if (foldedTaskValidity) {
      taskValidity = {
        isAmbiguous: foldedTaskValidity.is_ambiguous,
        isInvalid: foldedTaskValidity.is_invalid,
        ambiguityReason:
          foldedTaskValidity.is_ambiguous && foldedTaskValidity.ambiguity_reason
            ? foldedTaskValidity.ambiguity_reason
            : undefined,
        invalidReason:
          foldedTaskValidity.is_invalid && foldedTaskValidity.invalid_reason
            ? foldedTaskValidity.invalid_reason
            : undefined,
      };
    } else if (optionalsMode === "separate") {
      taskValidity = await this.classifyTaskValidity(taskSpec).catch(
        (): EvaluationResult["taskValidity"] => ({
          isAmbiguous: false,
          isInvalid: false,
        }),
      );
    } else {
      taskValidity = { isAmbiguous: false, isInvalid: false };
    }

    return {
      outcomeSuccess: fusedOutcome?.output_success ?? false,
      processScore,
      perCriterion,
      taskValidity,
      evidenceInsufficient,
      findings: findings.length > 0 ? findings : undefined,
      firstPointOfFailure,
      rawSteps: {
        primaryIntent: fusedOutcome?.primary_intent,
        reasoning: fusedOutcome?.reasoning,
        rubricSource,
        approach,
        optionalsMode,
        totalEarned: totals.earned,
        totalMax: totals.max,
        evidenceImages: evidence.filter(isImageEvidence).length,
        evidenceTexts: evidence.filter(isTextEvidence).length,
        evidenceOriginalScreenshots: loaded.originalCount,
      },
    };
  }

  private emptyTrajectoryResult(rubric?: Rubric): EvaluationResult {
    const items = rubric?.items ?? [];
    return {
      outcomeSuccess: false,
      explanation:
        "No trajectory steps or final answer were captured; skipped verifier LLM calls.",
      processScore: 0,
      perCriterion: items.map((c) => ({
        criterion: c.criterion,
        maxPoints: c.maxPoints,
        earnedPoints: 0,
        explanation:
          "No trajectory steps or final answer were captured; skipped verifier LLM calls.",
        evidenceInsufficient: true,
      })),
      taskValidity: { isAmbiguous: false, isInvalid: false },
      evidenceInsufficient: items.map((c) => c.criterion),
      rawSteps: {
        reason: "empty-trajectory",
        rubricSource: rubric ? "precomputed" : "none",
      },
    };
  }

  /**
   * Step 2 (NEW) — batched relevance scoring.
   *
   * Replaces the per-(criterion, frame) fan-out with B evidence points per
   * call, all criteria scored at once. The model gets the rubric block, a
   * textual manifest describing each evidence point in this batch (with
   * `evidence_idx` labels), and the actual evidence as inline image_url
   * parts (for images) plus text blocks (for ariaTree).
   *
   * Batch size B is `VERIFIER_RELEVANCE_BATCH_SIZE` (default 4). Calls run
   * in parallel up to `VERIFIER_MAX_PARALLEL`.
   *
   * Returns a Map keyed by canonicalIndex; each entry is a Map<criterionIdx, score>.
   * Evidence points whose call fails get an all-zeros entry so downstream
   * Step 3 still produces a valid top-K grouping.
   */
  private async scoreRelevanceBatched(args: {
    taskSpec: TaskSpec;
    rubric: Rubric;
    evidence: CanonicalEvidence[];
  }): Promise<Map<number, Map<number, number>>> {
    const { taskSpec, rubric, evidence } = args;
    const out = new Map<number, Map<number, number>>();
    if (evidence.length === 0) return out;

    const numCriteria = rubric.items.length;
    const rubricCriteriaText = rubric.items
      .map(
        (c, i) =>
          `\n${i}. **${c.criterion}**\n   Description: ${c.description}\n`,
      )
      .join("");

    const batchSize = Math.max(
      1,
      readPositiveIntEnv(
        "VERIFIER_RELEVANCE_BATCH_SIZE",
        DEFAULT_RELEVANCE_BATCH_SIZE,
      ),
    );

    const batches: CanonicalEvidence[][] = [];
    for (let i = 0; i < evidence.length; i += batchSize) {
      batches.push(evidence.slice(i, i + batchSize));
    }

    const limit = pLimit(
      readPositiveIntEnv("VERIFIER_MAX_PARALLEL", DEFAULT_MAX_PARALLEL),
    );

    const tasks = batches.map((batch) =>
      limit(async () => {
        const manifest = renderEvidenceManifest(batch);
        const prompt = renderPrompt(MM_BATCHED_RELEVANCE_PROMPT, {
          task_definition: taskSpec.instruction,
          init_url_context: buildInitUrlContext(taskSpec.initUrl),
          rubric_criteria: rubricCriteriaText,
          evidence_manifest: manifest,
        });

        const messageContent: Array<
          | { type: "text"; text: string }
          | {
              type: "image_url";
              image_url: { url: string };
            }
        > = [{ type: "text", text: prompt }];

        for (const ev of batch) {
          if (isImageEvidence(ev)) {
            messageContent.push({
              type: "image_url",
              image_url: {
                url: `data:${ev.mediaType};base64,${ev.bytes.toString("base64")}`,
              },
            });
          } else {
            messageContent.push({
              type: "text",
              text: `\n[evidence_idx=${ev.canonicalIndex} — ${textEvidenceLabel(ev)} at step ${ev.originalStepIndex}]\n${ev.content}\n`,
            });
          }
        }

        try {
          const client = this.getClient();
          const response = await client.createChatCompletion<
            LLMParsedResponse<LLMResponse>
          >({
            logger: this.logger,
            options: {
              messages: [
                {
                  role: "system",
                  content:
                    "You are scoring how relevant each evidence point in a batch is to each rubric criterion. Output only valid JSON conforming to the schema in the user message.",
                },
                { role: "user", content: messageContent },
              ],
              response_model: {
                name: "BatchedRelevance",
                schema: BatchedRelevanceResponseSchema,
              },
            },
          });
          const data = response.data as unknown as z.infer<
            typeof BatchedRelevanceResponseSchema
          >;
          for (const item of data.items) {
            const scoreMap = new Map<number, number>();
            for (const s of item.scores) {
              if (s.criterion_idx >= 0 && s.criterion_idx < numCriteria) {
                scoreMap.set(s.criterion_idx, s.score);
              }
            }
            for (let i = 0; i < numCriteria; i++) {
              if (!scoreMap.has(i)) scoreMap.set(i, 0);
            }
            out.set(item.evidence_idx, scoreMap);
          }
        } catch {
          // Per-batch failure: zero out the whole batch so the pipeline
          // continues. Step 3 simply won't select these evidence points.
          for (const ev of batch) {
            const scoreMap = new Map<number, number>();
            for (let i = 0; i < numCriteria; i++) scoreMap.set(i, 0);
            out.set(ev.canonicalIndex, scoreMap);
          }
        }
      }),
    );

    await Promise.all(tasks);

    // Pad any missing evidence indices with zeros (defensive against the
    // model omitting batch entries).
    for (const ev of evidence) {
      if (!out.has(ev.canonicalIndex)) {
        const scoreMap = new Map<number, number>();
        for (let i = 0; i < numCriteria; i++) scoreMap.set(i, 0);
        out.set(ev.canonicalIndex, scoreMap);
      }
    }

    return out;
  }

  /**
   * Approach A — per-criterion analysis with embedded scoring.
   *
   * One call per rubric criterion: each call sees the criterion's top-K
   * evidence points (images + ariaTree snippets), the action history, and
   * the final answer. The response includes `earned_points` directly, so
   * `processScore` is deterministic (Σ earned / Σ max) — no whole-rubric
   * rescoring call needed.
   */
  private async scorePerCriterion(args: {
    trajectory: Trajectory;
    taskSpec: TaskSpec;
    rubric: Rubric;
    evidence: CanonicalEvidence[];
    groupedTopK: Map<number, number[]>;
  }): Promise<CriterionScore[]> {
    const { trajectory, taskSpec, rubric, evidence, groupedTopK } = args;
    if (rubric.items.length === 0) return [];

    const evidenceByIdx = new Map<number, CanonicalEvidence>();
    for (const e of evidence) evidenceByIdx.set(e.canonicalIndex, e);

    const actionHistory = this.formatActionHistory(trajectory);
    const predictedOutput =
      trajectory.finalAnswer ?? "(no final answer recorded)";

    const limit = pLimit(
      readPositiveIntEnv("VERIFIER_MAX_PARALLEL", DEFAULT_MAX_PARALLEL),
    );

    const tasks = rubric.items.map((criterion, cIdx) =>
      limit(async (): Promise<CriterionScore> => {
        const topK = groupedTopK.get(cIdx) ?? [];
        const evidencePoints = topK
          .map((eIdx) => evidenceByIdx.get(eIdx))
          .filter((e): e is CanonicalEvidence => e !== undefined);

        const manifest =
          evidencePoints.length === 0
            ? "(no evidence scored highly enough for this criterion — rely on action history)"
            : renderEvidenceManifest(evidencePoints);

        const conditionLine = criterion.condition
          ? `- Condition: ${criterion.condition}`
          : "";

        const prompt = renderPrompt(MM_PER_CRITERION_SCORE_PROMPT, {
          task_definition: taskSpec.instruction,
          init_url_context: buildInitUrlContext(taskSpec.initUrl),
          action_history: actionHistory,
          agent_predicted_output: predictedOutput,
          criterion_idx: cIdx,
          criterion_name: criterion.criterion,
          criterion_description: criterion.description,
          criterion_max_points: criterion.maxPoints,
          criterion_condition: conditionLine,
          evidence_manifest: manifest,
        });

        const messageContent: Array<
          | { type: "text"; text: string }
          | { type: "image_url"; image_url: { url: string } }
        > = [{ type: "text", text: prompt }];

        for (const ev of evidencePoints) {
          if (isImageEvidence(ev)) {
            messageContent.push({
              type: "image_url",
              image_url: {
                url: `data:${ev.mediaType};base64,${ev.bytes.toString("base64")}`,
              },
            });
          } else {
            messageContent.push({
              type: "text",
              text: `\n[evidence_idx=${ev.canonicalIndex} — ${textEvidenceLabel(ev)} at step ${ev.originalStepIndex}]\n${ev.content}\n`,
            });
          }
        }

        try {
          const client = this.getClient();
          const response = await client.createChatCompletion<
            LLMParsedResponse<LLMResponse>
          >({
            logger: this.logger,
            options: {
              messages: [
                {
                  role: "system",
                  content:
                    "You are scoring one rubric criterion against the most relevant evidence from an agent's trajectory. Output only valid JSON conforming to the schema in the user message.",
                },
                { role: "user", content: messageContent },
              ],
              response_model: {
                name: "PerCriterionScore",
                schema: PerCriterionScoreResponseSchema,
              },
            },
          });
          const data = response.data as unknown as z.infer<
            typeof PerCriterionScoreResponseSchema
          >;
          const clamped = Math.max(
            0,
            Math.min(criterion.maxPoints, data.earned_points),
          );
          return {
            criterion: criterion.criterion,
            maxPoints: criterion.maxPoints,
            earnedPoints: clamped,
            explanation: data.justification,
            evidenceInsufficient: data.evidence_sufficient === false,
          };
        } catch {
          return {
            criterion: criterion.criterion,
            maxPoints: criterion.maxPoints,
            earnedPoints: null,
            explanation:
              "Per-criterion scoring call failed; falling back to evidence-insufficient.",
            evidenceInsufficient: true,
          };
        }
      }),
    );

    return Promise.all(tasks);
  }

  /**
   * Approach B — single fused multimodal call that returns the full
   * EvaluationResult shape in one structured response.
   *
   * Sends rubric + per-criterion top-K evidence + action history + final
   * answer. Optionally folds first-point-of-failure (when foldFailure) and
   * task-validity classification (when foldValidity) into the response.
   *
   * Image evidence is attached inline; text evidence (ariaTree) is embedded
   * in the prompt under each criterion's manifest section.
   */
  private async fusedJudgment(args: {
    trajectory: Trajectory;
    taskSpec: TaskSpec;
    rubric: Rubric;
    evidence: CanonicalEvidence[];
    groupedTopK: Map<number, number[]>;
    foldFailure: boolean;
    foldValidity: boolean;
  }): Promise<z.infer<typeof FusedJudgmentResponseSchema>> {
    const {
      trajectory,
      taskSpec,
      rubric,
      evidence,
      groupedTopK,
      foldFailure,
      foldValidity,
    } = args;

    const evidenceByIdx = new Map<number, CanonicalEvidence>();
    for (const e of evidence) evidenceByIdx.set(e.canonicalIndex, e);

    const usedImageIndices = new Set<number>();
    for (const topK of groupedTopK.values()) {
      for (const eIdx of topK) {
        const p = evidenceByIdx.get(eIdx);
        if (p && isImageEvidence(p)) usedImageIndices.add(eIdx);
      }
    }
    const usedImages = [...usedImageIndices]
      .sort((a, b) => a - b)
      .map((eIdx) => evidenceByIdx.get(eIdx))
      .filter((p): p is CanonicalScreenshot => !!p && isImageEvidence(p));

    const rubricBlock = rubric.items
      .map((c, i) => {
        const cond = c.condition ? `\n   Condition: ${c.condition}` : "";
        return `Criterion ${i} — "${c.criterion}" (max ${c.maxPoints} pts):\n   Description: ${c.description}${cond}`;
      })
      .join("\n\n");

    const evidenceBlock = renderGroupedEvidenceForApproach(
      rubric,
      evidence,
      groupedTopK,
    );

    const taxonomyBlock = foldFailure
      ? `\n${getTaxonomyText(1, 6, 4)}\n${getTaxonomyText(7, 8, 4)}\n`
      : "";

    const prompt = renderPrompt(FUSED_JUDGMENT_PROMPT, {
      task_definition: taskSpec.instruction,
      init_url_context: buildInitUrlContext(taskSpec.initUrl),
      action_history: this.formatActionHistory(trajectory),
      agent_predicted_output:
        trajectory.finalAnswer ?? "(no final answer recorded)",
      rubric_block: rubricBlock,
      evidence_block: evidenceBlock,
      taxonomy_block: taxonomyBlock,
      fold_failure_analysis: foldFailure ? "true" : "false",
      fold_task_validity: foldValidity ? "true" : "false",
      current_date: new Date().toISOString().slice(0, 10),
    });

    const messageContent: Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    > = [{ type: "text", text: prompt }];

    for (const img of usedImages) {
      messageContent.push({
        type: "image_url",
        image_url: {
          url: `data:${img.mediaType};base64,${img.bytes.toString("base64")}`,
        },
      });
    }

    try {
      const client = this.getClient();
      const response = await client.createChatCompletion<
        LLMParsedResponse<LLMResponse>
      >({
        logger: this.logger,
        options: {
          messages: [
            {
              role: "system",
              content:
                "You are an expert evaluator of web-navigation agent trajectories. Output only valid JSON conforming to the schema in the user message.",
            },
            { role: "user", content: messageContent },
          ],
          response_model: {
            name: "FusedJudgment",
            schema: FusedJudgmentResponseSchema,
          },
        },
      });
      return response.data as unknown as z.infer<
        typeof FusedJudgmentResponseSchema
      >;
    } catch (e) {
      // Hard failure of the fused call: synthesize a no-confidence result
      // so the pipeline can still produce an EvaluationResult object.
      void e;
      return {
        outcome: {
          primary_intent: taskSpec.instruction,
          reasoning:
            "Fused judgment LLM call failed; returning evidence-insufficient result.",
          output_success: false,
          findings: [
            {
              category: "verifier_uncertainty" as const,
              severity: "warning" as const,
              description:
                "The fused judgment call did not return a parseable response.",
            },
          ],
        },
        per_criterion: rubric.items.map((c, i) => ({
          criterion_idx: i,
          applicable_evidence: "",
          justification: "Fused judgment call failed for this criterion.",
          earned_points: 0,
          evidence_sufficient: false,
        })),
      };
    }
  }

  /**
   * Approach A's combined Step 8 (+ optional folded 9a/10).
   *
   * Consumes the pre-scored rubric from scorePerCriterion and produces the
   * outcome result. When foldFailure/foldValidity are set, the response
   * also includes first-point-of-failure and task-validity, saving 1–2
   * extra LLM calls.
   */
  private async verifyOutcomeFused(args: {
    trajectory: Trajectory;
    taskSpec: TaskSpec;
    rubric: Rubric;
    perCriterion: CriterionScore[];
    evidence: CanonicalEvidence[];
    foldFailure: boolean;
    foldValidity: boolean;
  }): Promise<z.infer<typeof FusedOutcomeResponseSchema>> {
    const {
      trajectory,
      taskSpec,
      rubric,
      perCriterion,
      foldFailure,
      foldValidity,
    } = args;
    void args.evidence;

    const taxonomyBlock = foldFailure
      ? `\n${getTaxonomyText(1, 6, 4)}\n${getTaxonomyText(7, 8, 4)}\n`
      : "";

    const prompt = renderPrompt(FUSED_OUTCOME_PROMPT, {
      task_definition: taskSpec.instruction,
      init_url_context: buildInitUrlContext(taskSpec.initUrl),
      action_history: this.formatActionHistory(trajectory),
      agent_predicted_output:
        trajectory.finalAnswer ?? "(no final answer recorded)",
      rubric_summary: this.formatScoredRubricSummary(rubric, perCriterion),
      taxonomy_block: taxonomyBlock,
      fold_failure_analysis: foldFailure ? "true" : "false",
      fold_task_validity: foldValidity ? "true" : "false",
      current_date: new Date().toISOString().slice(0, 10),
    });

    try {
      const client = this.getClient();
      const response = await client.createChatCompletion<
        LLMParsedResponse<LLMResponse>
      >({
        logger: this.logger,
        options: {
          messages: [
            {
              role: "system",
              content:
                "You are an expert evaluator of web-navigation agent trajectories. Output only valid JSON conforming to the schema in the user message.",
            },
            { role: "user", content: prompt },
          ],
          response_model: {
            name: "FusedOutcome",
            schema: FusedOutcomeResponseSchema,
          },
        },
      });
      return response.data as unknown as z.infer<
        typeof FusedOutcomeResponseSchema
      >;
    } catch {
      // Failure surfaces as a no-confidence result.
      return {
        outcome: {
          primary_intent: taskSpec.instruction,
          reasoning:
            "Outcome LLM call failed; defaulting to output_success=false.",
          output_success: false,
          findings: [
            {
              category: "verifier_uncertainty" as const,
              severity: "warning" as const,
              description:
                "The outcome verification call did not return a parseable response.",
            },
          ],
        },
      };
    }
  }

  /**
   * Flat per-step evidence summary — fallback for trajectories with no
   * probe screenshots, such as harness-adapter or stubbed trajectories.
   */
  private buildEvidenceContext(
    trajectory: Trajectory,
    opts: { includeImages?: boolean } = {},
  ): EvidenceContext {
    if (trajectory.steps.length === 0) {
      return { text: "(no steps captured)", images: [] };
    }

    const text = clampToTokenBudget(
      trajectory.steps
        .map((s, i) => {
          const url = s.probeEvidence.url ? `, url=${s.probeEvidence.url}` : "";
          const hasScreenshot =
            s.probeEvidence.screenshotPath || s.probeEvidence.screenshot
              ? "yes"
              : "no";
          const tier1 = s.agentEvidence.modalities
            .map((m) => {
              if (m.type === "text") return `text(${m.content.slice(0, 160)})`;
              if (m.type === "image") return `image(${m.bytes.length} bytes)`;
              return `json(${safeJsonSnippet(m.content, 180)})`;
            })
            .join(", ");
          const toolOutput = safeJsonSnippet(s.toolOutput.result, 220);
          // Include the post-step a11y dump when captured — gives the
          // verifier textual ground truth for criteria that can't be cleanly
          // verified from the visual probe alone (prices, names, list
          // contents). Truncate per step so the total budget stays bounded.
          const ariaSnippet =
            typeof s.probeEvidence.ariaTree === "string" &&
            s.probeEvidence.ariaTree.length > 0
              ? `\n  aria_tree: ${s.probeEvidence.ariaTree.slice(0, 1200)}${
                  s.probeEvidence.ariaTree.length > 1200 ? "… [truncated]" : ""
                }`
              : "";
          return `Screenshot ${i + 1} — step=${s.index}, action=${s.actionName}${url}, probe_screenshot=${hasScreenshot}\n  tier1: ${tier1 || "(none)"}\n  tool_output: ${toolOutput}${ariaSnippet}`;
        })
        .join("\n\n"),
      readPositiveIntEnv(
        "VERIFIER_EVIDENCE_TOKEN_BUDGET",
        DEFAULT_EVIDENCE_TOKEN_BUDGET,
      ),
    );

    if (opts.includeImages === false) return { text, images: [] };

    return {
      text,
      images: selectRecentImages(
        trajectory,
        readPositiveIntEnv(
          "VERIFIER_OUTCOME_MAX_IMAGES",
          DEFAULT_OUTCOME_IMAGE_LIMIT,
        ),
      ),
    };
  }

  /**
   * Step 0a — rubric generation from task description alone.
   */
  async generateRubric(taskSpec: TaskSpec): Promise<Rubric> {
    const prompt = renderPrompt(RUBRIC_GENERATION_PROMPT, {
      task_id: taskSpec.instruction,
      init_url_context: buildInitUrlContext(taskSpec.initUrl),
    });

    const client = this.getClient();
    const response = await client.createChatCompletion<
      LLMParsedResponse<LLMResponse>
    >({
      logger: this.logger,
      options: {
        messages: [
          {
            role: "system",
            content:
              "You are an expert rubric author. Output only valid JSON conforming to the schema requested in the user message. Do not include explanatory prose.",
          },
          { role: "user", content: prompt },
        ],
        response_model: { name: "Rubric", schema: RubricSchema },
      },
    });

    const data = response.data as unknown as z.infer<typeof RubricSchema>;
    const normalized = normalizeRubric(data);
    if (!normalized) {
      throw new Error("Rubric generation returned no rubric");
    }
    return normalized;
  }

  /**
   * Step 9a — first-point-of-failure analysis.
   *
   * Identifies all distinct failure points in the trajectory using the
   * taxonomy categories 1–6 (agent-controllable errors). Picks the earliest
   * one (lowest step number) and returns it as FirstPointOfFailure. Diagnostic
   * signal only; doesn't affect scoring.
   *
   * Best-effort: returns undefined if the LLM call throws, the model returns
   * unparseable output, or no failures are identified. The result's
   * firstPointOfFailure stays absent in that case rather than blocking the
   * rest of the pipeline.
   */
  private async analyzeFailures(args: {
    trajectory: Trajectory;
    taskSpec: TaskSpec;
    rubric: Rubric;
    perCriterion: CriterionScore[];
    outcome: z.infer<typeof OutcomeSchema>;
  }): Promise<EvaluationResult["firstPointOfFailure"]> {
    const { trajectory, taskSpec, rubric, perCriterion, outcome } = args;
    const evidenceContext = this.buildEvidenceContext(trajectory, {
      includeImages: false,
    });

    const prompt = renderPrompt(FIRST_POINT_OF_FAILURE_PROMPT, {
      task_definition: taskSpec.instruction,
      init_url_context: buildInitUrlContext(taskSpec.initUrl),
      action_history: this.formatActionHistory(trajectory),
      predicted_output: trajectory.finalAnswer ?? "(no final answer recorded)",
      rubric_summary: this.formatScoredRubricSummary(rubric, perCriterion),
      evidence_summary: evidenceContext.text,
      outcome_verification: `output_success=${outcome.output_success}\nprimary_intent=${outcome.primary_intent}\nreasoning=${outcome.reasoning}`,
    });

    const client = this.getClient();
    const response = await client.createChatCompletion<
      LLMParsedResponse<LLMResponse>
    >({
      logger: this.logger,
      options: {
        messages: [
          {
            role: "system",
            content:
              "You are an expert failure analyst for computer-use web agents. Output only valid JSON conforming to the schema in the user message.",
          },
          { role: "user", content: prompt },
        ],
        response_model: {
          name: "FailureAnalysis",
          schema: FailureAnalysisSchema,
        },
      },
    });

    const data = response.data as unknown as z.infer<
      typeof FailureAnalysisSchema
    >;
    if (!data.has_failure || data.failure_points.length === 0) return undefined;

    // Find the failure with the earliest step number: lowest min-step across
    // all failure_points.
    let best: {
      minStep: number;
      point: z.infer<typeof FailurePointSchema>;
    } | null = null;
    for (const fp of data.failure_points) {
      const steps = parseFailureStepNumbers(fp.step_numbers, {
        maxStep: Math.max(0, trajectory.steps.length),
      });
      if (steps.length === 0) continue;
      const minStep = steps[0];
      if (best === null || minStep < best.minStep) {
        best = { minStep, point: fp };
      }
    }
    if (best === null) return undefined;

    return {
      stepIndex: best.minStep,
      errorCode: best.point.error_code,
      category: best.point.error_category,
      description: `${best.point.error_type}: ${best.point.what_happened}`,
    };
  }

  /**
   * Step 10 — task validity classification.
   *
   * Pure task-level analysis (no trajectory context needed). Classifies the
   * task across two axes from the error taxonomy: ambiguity (category 7) and
   * validity/feasibility (category 8). Populates EvaluationResult.taskValidity with
   * the booleans + optional taxonomy codes. Diagnostic signal only.
   *
   * Best-effort: returns undefined on LLM error; the caller substitutes the
   * default { isAmbiguous: false, isInvalid: false }.
   */
  private async classifyTaskValidity(
    taskSpec: TaskSpec,
  ): Promise<EvaluationResult["taskValidity"]> {
    const prompt = renderPrompt(TASK_VALIDITY_PROMPT, {
      task_definition: taskSpec.instruction,
      url: taskSpec.initUrl ?? "(none)",
      // For browser-driven tasks the app is always Edge/Chrome. The prompt
      // accepts a free-form apps field; keeping it accurate matters less than
      // anchoring the model with non-empty context.
      apps: "Edge",
      date: new Date().toISOString().slice(0, 10),
    });

    const client = this.getClient();
    const response = await client.createChatCompletion<
      LLMParsedResponse<LLMResponse>
    >({
      logger: this.logger,
      options: {
        messages: [
          {
            role: "system",
            content:
              "You are an expert failure analyst for computer-use web agents. Output only valid JSON conforming to the schema in the user message.",
          },
          { role: "user", content: prompt },
        ],
        response_model: {
          name: "TaskValidity",
          schema: TaskValiditySchema,
        },
      },
    });

    const data = response.data as unknown as z.infer<typeof TaskValiditySchema>;
    return {
      isAmbiguous: data.is_ambiguous,
      isInvalid: data.is_invalid,
      ambiguityReason:
        data.is_ambiguous && data.reasoning_is_ambiguous
          ? data.reasoning_is_ambiguous
          : undefined,
      invalidReason:
        data.is_invalid && data.reasoning_is_invalid
          ? data.reasoning_is_invalid
          : undefined,
    };
  }

  /**
   * Format the rubric with per-criterion rescored points + explanations for
   * Step 8's reference. The outcome verifier reads this to understand how a
   * separate scoring system viewed each criterion, but forms its own result.
   */
  private formatScoredRubricSummary(
    rubric: Rubric,
    scores: CriterionScore[],
  ): string {
    return rubric.items
      .map((c, i) => {
        const cond = c.condition ? ` [condition: ${c.condition}]` : "";
        const score = scores[i];
        const earned = score?.earnedPoints ?? "—";
        const explanation = score?.explanation ?? "";
        return `${i + 1}. ${c.criterion} (${earned}/${c.maxPoints} pts)${cond}\n   Description: ${c.description}\n   Score explanation: ${explanation}`;
      })
      .join("\n\n");
  }

  /**
   * Compact textual action history for embedding in prompts. One line per
   * step: tool name, brief argument summary, and the first ~140 chars of
   * reasoning. The full per-step detail lives in trajectory.json on disk.
   */
  private formatActionHistory(trajectory: Trajectory): string {
    const history = trajectory.steps
      .map((s) => {
        const argSummary = summarizeArgs(s.actionArgs);
        const reasoning = (s.reasoning ?? "").slice(0, 140);
        const url = s.probeEvidence.url ? ` @ ${s.probeEvidence.url}` : "";
        return `Step ${s.index}: ${s.actionName}(${argSummary})${url}${reasoning ? `\n  reasoning: ${reasoning}` : ""}`;
      })
      .join("\n");
    return clampToTokenBudget(
      history,
      readPositiveIntEnv(
        "VERIFIER_ACTION_HISTORY_TOKEN_BUDGET",
        DEFAULT_ACTION_HISTORY_TOKEN_BUDGET,
      ),
    );
  }
}

interface EvidenceImage {
  label: string;
  bytes: Buffer;
  mediaType: string;
}

interface EvidenceContext {
  text: string;
  images: EvidenceImage[];
}

/**
 * Tiny in-tree p-limit implementation. We avoid pulling in the `p-limit`
 * package: the verifier already has zero net-new deps for the prompts/
 * orchestration layer, and core ships a lot of small consumers — fewer
 * deps means smaller bundles for everyone.
 *
 * Returns a function that wraps a thunk; at most `concurrency` thunks run
 * at any time. Pending thunks queue FIFO.
 */
function pLimit(concurrency: number): <T>(fn: () => Promise<T>) => Promise<T> {
  const n = Math.max(1, Math.floor(concurrency));
  let active = 0;
  const queue: Array<() => void> = [];
  const next = () => {
    if (active >= n) return;
    const job = queue.shift();
    if (job) {
      active++;
      job();
    }
  };
  return <T>(fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      queue.push(() => {
        fn()
          .then(resolve, reject)
          .finally(() => {
            active--;
            next();
          });
      });
      next();
    });
}

/** Collapse newlines for compact embedding in another prompt. */
function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function selectRecentImages(
  trajectory: Trajectory,
  limit: number,
): EvidenceImage[] {
  if (limit <= 0) return [];

  const images: EvidenceImage[] = [];
  const seen = new Set<string>();

  for (const step of [...trajectory.steps].reverse()) {
    const candidates: EvidenceImage[] = [];
    if (step.probeEvidence.screenshot) {
      candidates.push({
        label: `step ${step.index} probe screenshot`,
        bytes: step.probeEvidence.screenshot,
        mediaType: "image/png",
      });
    }
    for (const modality of step.agentEvidence.modalities) {
      if (modality.type === "image") {
        candidates.push({
          label: `step ${step.index} agent image`,
          bytes: modality.bytes,
          mediaType: modality.mediaType,
        });
      }
    }

    for (const candidate of candidates) {
      const key = `${candidate.mediaType}:${candidate.bytes.length}:${candidate.bytes.subarray(0, 32).toString("base64")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      images.push(candidate);
      if (images.length >= limit) return images.reverse();
    }
  }

  return images.reverse();
}

function clampToTokenBudget(text: string, tokenBudget: number): string {
  const maxChars = Math.max(0, tokenBudget) * APPROX_CHARS_PER_TOKEN;
  if (maxChars === 0 || text.length <= maxChars) return text;

  const keepHead = Math.floor(maxChars * 0.35);
  const keepTail = Math.max(0, maxChars - keepHead - 120);
  return [
    text.slice(0, keepHead).trimEnd(),
    `\n...[truncated ${text.length - keepHead - keepTail} chars to fit verifier context budget]...\n`,
    text.slice(text.length - keepTail).trimStart(),
  ].join("");
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function safeJsonSnippet(value: unknown, maxChars: number): string {
  let raw: string;
  try {
    raw = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    raw = String(value);
  }
  if (raw === undefined) return "(undefined)";
  return raw.length > maxChars ? `${raw.slice(0, maxChars)}...` : raw;
}

function summarizeArgs(args: Record<string, unknown>): string {
  const keys = Object.keys(args);
  if (keys.length === 0) return "";
  return keys
    .slice(0, 3)
    .map((k) => {
      const v = args[k];
      if (typeof v === "string") return `${k}: ${v.slice(0, 60)}`;
      if (typeof v === "number" || typeof v === "boolean") return `${k}: ${v}`;
      return `${k}: ${typeof v}`;
    })
    .join(", ");
}
