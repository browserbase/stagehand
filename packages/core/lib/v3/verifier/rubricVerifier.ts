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
  Rubric,
  RubricVerifierOptions,
  TaskSpec,
  Trajectory,
  Verifier,
  VerifierConfig,
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
  task_span: z.string().optional(),
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

const FusedOutcomeSchema = z.object({
  primary_intent: z.string(),
  reasoning: z.string(),
  output_success: z.boolean(),
  findings: z.array(FindingSchema).optional().default([]),
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

/** Outcome-only response: no per_criterion field, just outcome + diagnostics. */
const FusedOutcomeResponseSchema = z.object({
  outcome: FusedOutcomeSchema,
  failure_point: FusedFailurePointSchema.optional(),
  task_validity: FusedTaskValiditySchema.optional(),
});

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
const DEFAULT_OUTCOME_EVIDENCE_TOKEN_BUDGET = 4_000;
const DEFAULT_OUTCOME_IMAGE_LIMIT = 3;
const DEFAULT_MAX_PARALLEL = 8;
const DEFAULT_TOP_K = 5;
const DEFAULT_RELEVANCE_BATCH_SIZE = 4;
const OUTCOME_EVIDENCE_MAX_STEPS = 14;
const OUTCOME_EVIDENCE_STEP_CHARS = 900;
/**
 * How much of the final aria tree to include in the always-attached
 * "Final trajectory state" block. The verifier needs to see the end-of-run
 * page content reliably — the top-K/relevance selection can starve it out
 * when the final probe doesn't textually match the task keywords. 20k chars
 * (~5k tokens) is comfortably above typical page sizes while bounded.
 */
const FINAL_STATE_ARIA_CHARS = 20_000;
type VerifierApproach = VerifierConfig["approach"];
type OptionalStepsMode = VerifierConfig["optionalSteps"];
const DEFAULT_APPROACH: VerifierApproach = "b";
const DEFAULT_OPTIONAL_STEPS_MODE: OptionalStepsMode = "folded";

const NO_TRUNC = Number.MAX_SAFE_INTEGER;

function readPositiveIntEnv(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
): number {
  const raw = env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readChars(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  disabled: boolean,
): number {
  if (disabled) return NO_TRUNC;
  return readPositiveIntEnv(env, name, fallback);
}

function readApproach(env: NodeJS.ProcessEnv): VerifierApproach {
  const raw = env.VERIFIER_APPROACH;
  if (raw === "a" || raw === "b" || raw === "outcome-only") return raw;
  return DEFAULT_APPROACH;
}

function readOptionalsMode(env: NodeJS.ProcessEnv): OptionalStepsMode {
  const raw = env.VERIFIER_OPTIONAL_STEPS;
  if (raw === "folded" || raw === "separate" || raw === "skip") return raw;
  return DEFAULT_OPTIONAL_STEPS_MODE;
}

/**
 * Resolve every verifier knob from env (+ optional overrides) into a frozen
 * VerifierConfig. Called once by RubricVerifier's constructor; per-call
 * overrides flow through verify()'s optional override arg.
 *
 * The master switch VERIFIER_DISABLE_TRUNCATION=1 lifts every per-section
 * limit to MAX_SAFE_INTEGER — useful on high-context models where
 * evidence-bound truncation is the bottleneck, not the token budget.
 */
export function resolveVerifierConfig(
  env: NodeJS.ProcessEnv = process.env,
  overrides: Partial<VerifierConfig> = {},
): VerifierConfig {
  const truncDisabled =
    overrides.truncation?.disabled ?? env.VERIFIER_DISABLE_TRUNCATION === "1";
  return {
    approach: overrides.approach ?? readApproach(env),
    optionalSteps: overrides.optionalSteps ?? readOptionalsMode(env),
    topK:
      overrides.topK ??
      readPositiveIntEnv(env, "VERIFIER_TOP_K", DEFAULT_TOP_K),
    relevanceBatchSize:
      overrides.relevanceBatchSize ??
      readPositiveIntEnv(
        env,
        "VERIFIER_RELEVANCE_BATCH_SIZE",
        DEFAULT_RELEVANCE_BATCH_SIZE,
      ),
    outcomeMaxImages:
      overrides.outcomeMaxImages ??
      readPositiveIntEnv(
        env,
        "VERIFIER_OUTCOME_MAX_IMAGES",
        DEFAULT_OUTCOME_IMAGE_LIMIT,
      ),
    maxParallel:
      overrides.maxParallel ??
      readPositiveIntEnv(env, "VERIFIER_MAX_PARALLEL", DEFAULT_MAX_PARALLEL),
    evidenceTokenBudget:
      overrides.evidenceTokenBudget ??
      readPositiveIntEnv(
        env,
        "VERIFIER_EVIDENCE_TOKEN_BUDGET",
        DEFAULT_EVIDENCE_TOKEN_BUDGET,
      ),
    outcomeEvidenceTokenBudget:
      overrides.outcomeEvidenceTokenBudget ??
      readPositiveIntEnv(
        env,
        "VERIFIER_OUTCOME_EVIDENCE_TOKEN_BUDGET",
        DEFAULT_OUTCOME_EVIDENCE_TOKEN_BUDGET,
      ),
    actionHistoryTokenBudget:
      overrides.actionHistoryTokenBudget ??
      readPositiveIntEnv(
        env,
        "VERIFIER_ACTION_HISTORY_TOKEN_BUDGET",
        DEFAULT_ACTION_HISTORY_TOKEN_BUDGET,
      ),
    truncation: {
      disabled: truncDisabled,
      evidenceTextPreview:
        overrides.truncation?.evidenceTextPreview ??
        readChars(
          env,
          "VERIFIER_EVIDENCE_TEXT_PREVIEW_CHARS",
          200,
          truncDisabled,
        ),
      groupedEvidenceText:
        overrides.truncation?.groupedEvidenceText ??
        readChars(
          env,
          "VERIFIER_GROUPED_EVIDENCE_TEXT_CHARS",
          600,
          truncDisabled,
        ),
      buildEvidenceText:
        overrides.truncation?.buildEvidenceText ??
        readChars(
          env,
          "VERIFIER_BUILD_EVIDENCE_TEXT_CHARS",
          160,
          truncDisabled,
        ),
      buildEvidenceAria:
        overrides.truncation?.buildEvidenceAria ??
        readChars(
          env,
          "VERIFIER_BUILD_EVIDENCE_ARIA_CHARS",
          1200,
          truncDisabled,
        ),
      actionHistoryReasoning:
        overrides.truncation?.actionHistoryReasoning ??
        readChars(
          env,
          "VERIFIER_ACTION_HISTORY_REASONING_CHARS",
          140,
          truncDisabled,
        ),
    },
  };
}

function mergeConfig(
  base: VerifierConfig,
  overrides?: Partial<VerifierConfig>,
): VerifierConfig {
  if (!overrides) return base;
  return {
    ...base,
    ...overrides,
    truncation: { ...base.truncation, ...(overrides.truncation ?? {}) },
  };
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

function evidencePreview(
  point: CanonicalEvidence,
  previewChars: number,
): string {
  if (isImageEvidence(point)) {
    return `Screenshot at step ${point.originalStepIndex} (${point.bytes.length} bytes, ${point.mediaType})`;
  }
  const preview = point.content.slice(0, previewChars);
  return `${textEvidenceLabel(point)} at step ${point.originalStepIndex} — "${preview.replace(/\s+/g, " ")}${point.content.length > previewChars ? "…" : ""}"`;
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

function renderEvidenceManifest(
  points: CanonicalEvidence[],
  previewChars: number,
): string {
  if (points.length === 0) return "(no evidence captured)";
  return points
    .map(
      (p) =>
        `- evidence_idx=${p.canonicalIndex}: ${evidencePreview(p, previewChars)}`,
    )
    .join("\n");
}

function renderGroupedEvidenceForApproach(
  rubric: Rubric,
  evidence: CanonicalEvidence[],
  groupedTopK: Map<number, number[]>,
  textLimit: number,
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
        const text = p.content.replace(/\s+/g, " ").slice(0, textLimit);
        return `- Evidence #${eIdx} — ${textEvidenceLabel(p)} @ step=${p.originalStepIndex}: "${text}${p.content.length > textLimit ? "…" : ""}"`;
      })
      .filter((x): x is string => x !== null)
      .join("\n");
    sections.push(`### Criterion ${cIdx}: ${c.criterion}\n${body}`);
  }
  return sections.join("\n\n");
}

export class RubricVerifier implements Verifier {
  private readonly getClient: () => LLMClient;
  private readonly getRubricGenClient: () => LLMClient;
  private readonly logger: (line: LogLine) => void;
  private readonly baseConfig: VerifierConfig;

  constructor(opts: RubricVerifierOptions) {
    this.getClient = opts.getClient;
    this.getRubricGenClient = opts.getRubricGenClient ?? opts.getClient;
    this.logger = opts.logger ?? noopLogger;
    this.baseConfig = resolveVerifierConfig(process.env, opts.config);
  }

  /** Resolved verifier knobs the constructor saw, frozen at construction. */
  get config(): VerifierConfig {
    return this.baseConfig;
  }

  async verify(
    trajectory: Trajectory,
    overrides?: Partial<VerifierConfig>,
  ): Promise<EvaluationResult> {
    const taskSpec = trajectory.task;
    const config = mergeConfig(this.baseConfig, overrides);
    const hasTrajectorySignal =
      trajectory.steps.length > 0 || Boolean(trajectory.finalAnswer?.trim());
    if (!hasTrajectorySignal) {
      return this.emptyTrajectoryResult(
        normalizeRubric(taskSpec.precomputedRubric),
      );
    }

    const { approach, optionalSteps: optionalsMode } = config;

    if (approach === "outcome-only") {
      return this.verifyOutcomeOnly(trajectory, taskSpec, config);
    }

    let rubric: Rubric | undefined = normalizeRubric(
      taskSpec.precomputedRubric,
    );
    const rubricSource = rubric ? "precomputed" : "generated";
    if (!rubric) {
      rubric = await this.generateRubric(taskSpec);
    }

    // Empty-evidence trajectories fall back gracefully — the chosen approach
    // degrades to an action-history-only judgment downstream.
    const { evidence, loaded } = await collectCanonicalEvidence(trajectory);

    const relevanceScores = await this.scoreRelevanceBatched({
      taskSpec,
      rubric,
      evidence,
      config,
    });

    const groupedTopK = groupTopKByCriterion({
      numCriteria: rubric.items.length,
      relevanceScores,
      topK: config.topK,
    });

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
        config,
      });
      perCriterion = mapFusedPerCriterionToScores(rubric, fused.per_criterion);
      fusedOutcome = fused.outcome;
      foldedFailurePoint = fused.failure_point;
      foldedTaskValidity = fused.task_validity;
    } else {
      // Approach a: per-criterion analysis returns earned_points directly;
      // no separate whole-rubric rescore.
      perCriterion = await this.scorePerCriterion({
        trajectory,
        taskSpec,
        rubric,
        evidence,
        groupedTopK,
        config,
      });

      const outcome = await this.verifyOutcomeFused({
        trajectory,
        taskSpec,
        rubric,
        perCriterion,
        evidence,
        foldFailure: optionalsMode === "folded",
        foldValidity: optionalsMode === "folded",
        config,
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
        config,
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

  private async verifyOutcomeOnly(
    trajectory: Trajectory,
    taskSpec: TaskSpec,
    config: VerifierConfig,
  ): Promise<EvaluationResult> {
    const foldFailure = config.optionalSteps === "folded";
    const foldValidity = config.optionalSteps === "folded";
    const taxonomyBlock = foldFailure
      ? `\n${getTaxonomyText(1, 6, 4)}\n${getTaxonomyText(7, 8, 4)}\n`
      : "";

    const prompt = renderPrompt(FUSED_OUTCOME_PROMPT, {
      task_definition: taskSpec.instruction,
      init_url_context: buildInitUrlContext(taskSpec.initUrl),
      action_history: this.formatActionHistory(trajectory, config),
      outcome_evidence_summary: this.buildOutcomeEvidenceSummary(
        trajectory,
        taskSpec,
        config,
      ),
      final_state_block: buildFinalStateBlock(trajectory),
      agent_predicted_output:
        trajectory.finalAnswer ?? "(no final answer recorded)",
      rubric_summary:
        "(no rubric - outcome-only mode; judge success from the task, action history, final answer, and attached screenshots)",
      taxonomy_block: taxonomyBlock,
      fold_failure_analysis: foldFailure ? "true" : "false",
      fold_task_validity: foldValidity ? "true" : "false",
      current_date: currentDateForVerifier(),
    });

    const messageContent: Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    > = [{ type: "text", text: prompt }];

    // Final images first (always attached), then recent images deduped.
    const seenImageKeys = new Set<string>();
    const attachImage = (img: EvidenceImage): void => {
      const key = `${img.bytes.length}:${img.bytes.subarray(0, 32).toString("base64")}`;
      if (seenImageKeys.has(key)) return;
      seenImageKeys.add(key);
      messageContent.push({
        type: "image_url",
        image_url: {
          url: `data:${img.mediaType};base64,${img.bytes.toString("base64")}`,
        },
      });
    };
    for (const img of selectFinalImages(trajectory)) attachImage(img);
    for (const img of selectRecentImages(trajectory, config.outcomeMaxImages))
      attachImage(img);

    let fused: z.infer<typeof FusedOutcomeResponseSchema>;
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
            name: "FusedOutcome",
            schema: FusedOutcomeResponseSchema,
          },
        },
      });
      fused = response.data as unknown as z.infer<
        typeof FusedOutcomeResponseSchema
      >;
    } catch {
      fused = {
        outcome: {
          primary_intent: taskSpec.instruction,
          reasoning:
            "Outcome-only LLM call failed; defaulting to output_success=false.",
          output_success: false,
          findings: [
            {
              category: "verifier_uncertainty" as const,
              severity: "warning" as const,
              description:
                "The outcome-only verification call did not return a parseable response.",
            },
          ],
        },
      };
    }

    const outcomeSuccess = fused.outcome.output_success;
    const findings = (fused.outcome.findings ?? []).map((f) => ({
      ...f,
      category: f.category ?? ("other" as const),
      severity: f.severity ?? ("info" as const),
    }));

    let firstPointOfFailure: EvaluationResult["firstPointOfFailure"];
    if (fused.failure_point && !outcomeSuccess) {
      firstPointOfFailure = {
        stepIndex: fused.failure_point.step_index,
        errorCode: fused.failure_point.error_code,
        category: fused.failure_point.error_category,
        description: fused.failure_point.description,
      };
    }

    const taskValidity: EvaluationResult["taskValidity"] = fused.task_validity
      ? {
          isAmbiguous: fused.task_validity.is_ambiguous,
          isInvalid: fused.task_validity.is_invalid,
          ambiguityReason:
            fused.task_validity.is_ambiguous &&
            fused.task_validity.ambiguity_reason
              ? fused.task_validity.ambiguity_reason
              : undefined,
          invalidReason:
            fused.task_validity.is_invalid && fused.task_validity.invalid_reason
              ? fused.task_validity.invalid_reason
              : undefined,
        }
      : { isAmbiguous: false, isInvalid: false };

    return {
      outcomeSuccess,
      explanation: fused.outcome.reasoning,
      taskValidity,
      findings: findings.length > 0 ? findings : undefined,
      firstPointOfFailure,
      rawSteps: {
        primaryIntent: fused.outcome.primary_intent,
        reasoning: fused.outcome.reasoning,
        approach: "outcome-only",
        optionalsMode: config.optionalSteps,
        screenshotsAttached: seenImageKeys.size,
      },
    };
  }

  /**
   * Score every (evidence, criterion) pair with one batched call per chunk,
   * to avoid a per-(criterion, frame) fan-out. Failed batches contribute
   * all-zeros scores so the downstream top-K still produces valid groups.
   */
  private async scoreRelevanceBatched(args: {
    taskSpec: TaskSpec;
    rubric: Rubric;
    evidence: CanonicalEvidence[];
    config: VerifierConfig;
  }): Promise<Map<number, Map<number, number>>> {
    const { taskSpec, rubric, evidence, config } = args;
    const out = new Map<number, Map<number, number>>();
    if (evidence.length === 0) return out;

    const numCriteria = rubric.items.length;
    const rubricCriteriaText = rubric.items
      .map(
        (c, i) =>
          `\n${i}. **${c.criterion}**\n   Description: ${c.description}\n`,
      )
      .join("");

    const batchSize = Math.max(1, config.relevanceBatchSize);

    const batches: CanonicalEvidence[][] = [];
    for (let i = 0; i < evidence.length; i += batchSize) {
      batches.push(evidence.slice(i, i + batchSize));
    }

    const limit = pLimit(config.maxParallel);

    const tasks = batches.map((batch) =>
      limit(async () => {
        const manifest = renderEvidenceManifest(
          batch,
          config.truncation.evidenceTextPreview,
        );
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
          // continues — top-K won't select these evidence points.
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
   * One call per rubric criterion. Each call sees the criterion's top-K
   * evidence points (images + ariaTree snippets), the action history, and
   * the final answer; the response includes `earned_points` directly so the
   * process score is deterministic (Σ earned / Σ max).
   */
  private async scorePerCriterion(args: {
    trajectory: Trajectory;
    taskSpec: TaskSpec;
    rubric: Rubric;
    evidence: CanonicalEvidence[];
    groupedTopK: Map<number, number[]>;
    config: VerifierConfig;
  }): Promise<CriterionScore[]> {
    const { trajectory, taskSpec, rubric, evidence, groupedTopK, config } =
      args;
    if (rubric.items.length === 0) return [];

    const evidenceByIdx = new Map<number, CanonicalEvidence>();
    for (const e of evidence) evidenceByIdx.set(e.canonicalIndex, e);

    const actionHistory = this.formatActionHistory(trajectory, config);
    const predictedOutput =
      trajectory.finalAnswer ?? "(no final answer recorded)";

    const limit = pLimit(config.maxParallel);

    const tasks = rubric.items.map((criterion, cIdx) =>
      limit(async (): Promise<CriterionScore> => {
        const topK = groupedTopK.get(cIdx) ?? [];
        const evidencePoints = topK
          .map((eIdx) => evidenceByIdx.get(eIdx))
          .filter((e): e is CanonicalEvidence => e !== undefined);

        const manifest =
          evidencePoints.length === 0
            ? "(no evidence scored highly enough for this criterion — rely on action history)"
            : renderEvidenceManifest(
                evidencePoints,
                config.truncation.evidenceTextPreview,
              );

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
   * Single fused multimodal call returning the full EvaluationResult shape:
   * rubric + per-criterion top-K evidence + action history + final answer.
   * Optionally folds in first-point-of-failure and task-validity. Image
   * evidence rides inline; ariaTree text is embedded in the prompt under
   * each criterion's manifest section.
   */
  private async fusedJudgment(args: {
    trajectory: Trajectory;
    taskSpec: TaskSpec;
    rubric: Rubric;
    evidence: CanonicalEvidence[];
    groupedTopK: Map<number, number[]>;
    foldFailure: boolean;
    foldValidity: boolean;
    config: VerifierConfig;
  }): Promise<z.infer<typeof FusedJudgmentResponseSchema>> {
    const {
      trajectory,
      taskSpec,
      rubric,
      evidence,
      groupedTopK,
      foldFailure,
      foldValidity,
      config,
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
      config.truncation.groupedEvidenceText,
    );

    const taxonomyBlock = foldFailure
      ? `\n${getTaxonomyText(1, 6, 4)}\n${getTaxonomyText(7, 8, 4)}\n`
      : "";

    const prompt = renderPrompt(FUSED_JUDGMENT_PROMPT, {
      task_definition: taskSpec.instruction,
      init_url_context: buildInitUrlContext(taskSpec.initUrl),
      action_history: this.formatActionHistory(trajectory, config),
      agent_predicted_output:
        trajectory.finalAnswer ?? "(no final answer recorded)",
      rubric_block: rubricBlock,
      evidence_block: evidenceBlock,
      final_state_block: buildFinalStateBlock(trajectory),
      taxonomy_block: taxonomyBlock,
      fold_failure_analysis: foldFailure ? "true" : "false",
      fold_task_validity: foldValidity ? "true" : "false",
      current_date: currentDateForVerifier(),
    });

    const messageContent: Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    > = [{ type: "text", text: prompt }];

    // Always include the terminal visual evidence first — these bytes are the
    // single most reliable signal of what the agent actually saw at the end
    // of the run, and they're not subject to the per-criterion top-K cutoff.
    // Dedupe by content so we don't pay tokens twice when the top-K already
    // picked the same frame.
    const finalImageBytes = new Set<string>();
    for (const img of selectFinalImages(trajectory)) {
      const key = `${img.bytes.length}:${img.bytes.subarray(0, 32).toString("base64")}`;
      finalImageBytes.add(key);
      messageContent.push({
        type: "image_url",
        image_url: {
          url: `data:${img.mediaType};base64,${img.bytes.toString("base64")}`,
        },
      });
    }

    for (const img of usedImages) {
      const key = `${img.bytes.length}:${img.bytes.subarray(0, 32).toString("base64")}`;
      if (finalImageBytes.has(key)) continue;
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
   * Consume the pre-scored rubric from scorePerCriterion and produce the
   * outcome result. When foldFailure/foldValidity are set, the response also
   * includes first-point-of-failure and task-validity, saving 1–2 extra
   * LLM calls.
   */
  private async verifyOutcomeFused(args: {
    trajectory: Trajectory;
    taskSpec: TaskSpec;
    rubric: Rubric;
    perCriterion: CriterionScore[];
    evidence: CanonicalEvidence[];
    foldFailure: boolean;
    foldValidity: boolean;
    config: VerifierConfig;
  }): Promise<z.infer<typeof FusedOutcomeResponseSchema>> {
    const {
      trajectory,
      taskSpec,
      rubric,
      perCriterion,
      foldFailure,
      foldValidity,
      config,
    } = args;
    void args.evidence;

    const taxonomyBlock = foldFailure
      ? `\n${getTaxonomyText(1, 6, 4)}\n${getTaxonomyText(7, 8, 4)}\n`
      : "";

    const prompt = renderPrompt(FUSED_OUTCOME_PROMPT, {
      task_definition: taskSpec.instruction,
      init_url_context: buildInitUrlContext(taskSpec.initUrl),
      action_history: this.formatActionHistory(trajectory, config),
      outcome_evidence_summary: this.buildOutcomeEvidenceSummary(
        trajectory,
        taskSpec,
        config,
      ),
      final_state_block: buildFinalStateBlock(trajectory),
      agent_predicted_output:
        trajectory.finalAnswer ?? "(no final answer recorded)",
      rubric_summary: this.formatScoredRubricSummary(rubric, perCriterion),
      taxonomy_block: taxonomyBlock,
      fold_failure_analysis: foldFailure ? "true" : "false",
      fold_task_validity: foldValidity ? "true" : "false",
      current_date: currentDateForVerifier(),
    });

    // Always attach the terminal screenshots so the outcome judge can see the
    // final page state, regardless of the (formerly text-only) evidence
    // summary heuristics.
    const messageContent: Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    > = [{ type: "text", text: prompt }];
    for (const img of selectFinalImages(trajectory)) {
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
    config: VerifierConfig,
    opts: { includeImages?: boolean } = {},
  ): EvidenceContext {
    if (trajectory.steps.length === 0) {
      return { text: "(no steps captured)", images: [] };
    }

    const textLimit = config.truncation.buildEvidenceText;
    const ariaLimit = config.truncation.buildEvidenceAria;

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
              if (m.type === "text")
                return `text(${m.content.slice(0, textLimit)})`;
              if (m.type === "image") return `image(${m.bytes.length} bytes)`;
              return `json(${safeJsonSnippet(m.content, 180)})`;
            })
            .join(", ");
          const toolOutput = safeJsonSnippet(s.toolOutput.result, 220);
          // Include the post-step a11y dump when captured — textual ground
          // truth for criteria that can't be verified from the visual probe
          // alone (prices, names, list contents). Per-step cap keeps the
          // total budget bounded.
          const ariaSnippet =
            typeof s.probeEvidence.ariaTree === "string" &&
            s.probeEvidence.ariaTree.length > 0
              ? `\n  aria_tree: ${s.probeEvidence.ariaTree.slice(0, ariaLimit)}${
                  s.probeEvidence.ariaTree.length > ariaLimit
                    ? "… [truncated]"
                    : ""
                }`
              : "";
          return `Screenshot ${i + 1} — step=${i}, action=${s.actionName}${url}, probe_screenshot=${hasScreenshot}\n  tier1: ${tier1 || "(none)"}\n  tool_output: ${toolOutput}${ariaSnippet}`;
        })
        .join("\n\n"),
      config.evidenceTokenBudget,
    );

    if (opts.includeImages === false) return { text, images: [] };

    return {
      text,
      images: selectRecentImages(trajectory, config.outcomeMaxImages),
    };
  }

  /**
   * Compact text evidence for the one-call outcome verifier.
   *
   * Outcome-only does not run the rubric relevance selector, but it still needs
   * enough saved-page text to avoid replacing trajectory facts with model
   * memory. Select a bounded set of lexically relevant and recent steps, then
   * include short excerpts around task/final-answer terms.
   */
  private buildOutcomeEvidenceSummary(
    trajectory: Trajectory,
    taskSpec: TaskSpec,
    config: VerifierConfig,
  ): string {
    if (trajectory.steps.length === 0) return "(no steps captured)";

    const keywords = outcomeKeywords(
      `${taskSpec.instruction}\n${trajectory.finalAnswer ?? ""}`,
    );
    const lastImportantIndex = Math.max(0, trajectory.steps.length - 5);

    const candidates = trajectory.steps.map((step, position) => {
      const url = step.probeEvidence.url ?? "";
      const ariaTree = step.probeEvidence.ariaTree ?? "";
      const toolOutput = safeJsonSnippet(step.toolOutput?.result, 600);
      const actionArgs = safeJsonSnippet(step.actionArgs, 400);
      const haystack = [
        step.actionName,
        step.reasoning ?? "",
        url,
        actionArgs,
        toolOutput,
        ariaTree,
      ]
        .join("\n")
        .toLowerCase();

      let score = position >= lastImportantIndex ? 3 : 0;
      if (url) score += 1;
      if (
        /extract|observe|aria|navigate|click|type|search/i.test(step.actionName)
      ) {
        score += 1;
      }
      for (const keyword of keywords) {
        if (haystack.includes(keyword)) {
          score += keyword.length >= 8 ? 3 : 1;
        }
      }

      return { step, position, score };
    });

    const selected = new Set<number>();
    for (const candidate of [...candidates]
      .sort((a, b) => b.score - a.score || a.position - b.position)
      .slice(0, OUTCOME_EVIDENCE_MAX_STEPS)) {
      selected.add(candidate.position);
    }

    for (
      let i = Math.max(0, trajectory.steps.length - 4);
      i < trajectory.steps.length;
      i++
    ) {
      selected.add(i);
    }

    const sections = [...selected]
      .sort((a, b) => a - b)
      .map((position) => {
        const step = trajectory.steps[position];
        const url = step.probeEvidence.url
          ? ` url=${step.probeEvidence.url}`
          : "";
        const reasoning = step.reasoning
          ? `\n  reasoning: ${step.reasoning.slice(0, 220)}`
          : "";
        const toolOutput = step.toolOutput?.result
          ? `\n  tool_output: ${safeJsonSnippet(step.toolOutput.result, 320)}`
          : "";
        const ariaExcerpt = step.probeEvidence.ariaTree
          ? `\n  page_excerpt: ${bestOutcomeExcerpt(
              step.probeEvidence.ariaTree,
              keywords,
              OUTCOME_EVIDENCE_STEP_CHARS,
            )}`
          : "";
        return `Step ${position}: ${step.actionName}(${summarizeArgs(
          step.actionArgs,
        )})${url}${reasoning}${toolOutput}${ariaExcerpt}`;
      });

    return clampToTokenBudget(
      sections.join("\n\n"),
      config.outcomeEvidenceTokenBudget,
    );
  }

  /** Generate a rubric from the task description alone. */
  async generateRubric(taskSpec: TaskSpec): Promise<Rubric> {
    const prompt = renderPrompt(RUBRIC_GENERATION_PROMPT, {
      task_id: taskSpec.instruction,
      init_url_context: buildInitUrlContext(taskSpec.initUrl),
    });

    const maxAttempts = 3;
    let lastError: unknown;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const client = this.getRubricGenClient();
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
        const normalized = normalizeRubric({
          items: filterByTaskSpan(
            data.items,
            taskSpec.instruction,
            this.logger,
          ),
        });
        if (!normalized) {
          throw new Error("Rubric generation returned no rubric");
        }
        return normalized;
      } catch (err) {
        lastError = err;
        if (attempt === maxAttempts - 1) break;
        await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  /**
   * Identify all distinct failure points using taxonomy categories 1–6
   * (agent-controllable errors) and return the earliest one. Best-effort:
   * returns undefined on LLM failure / unparseable output / no failures
   * found, rather than blocking the rest of the pipeline.
   */
  private async analyzeFailures(args: {
    trajectory: Trajectory;
    taskSpec: TaskSpec;
    rubric: Rubric;
    perCriterion: CriterionScore[];
    outcome: z.infer<typeof FusedOutcomeSchema>;
    config: VerifierConfig;
  }): Promise<EvaluationResult["firstPointOfFailure"]> {
    const { trajectory, taskSpec, rubric, perCriterion, outcome, config } =
      args;
    const evidenceContext = this.buildEvidenceContext(trajectory, config, {
      includeImages: false,
    });

    const prompt = renderPrompt(FIRST_POINT_OF_FAILURE_PROMPT, {
      task_definition: taskSpec.instruction,
      init_url_context: buildInitUrlContext(taskSpec.initUrl),
      action_history: this.formatActionHistory(trajectory, config),
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
   * Classify the task across ambiguity (taxonomy category 7) and
   * validity/feasibility (category 8). Pure task-level analysis; no
   * trajectory context needed. Best-effort: returns undefined on LLM error.
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
   * Format the rubric with per-criterion rescored points + explanations.
   * The outcome verifier reads this as advisory context — it sees how a
   * separate scoring system viewed each criterion but forms its own result.
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
   * step. Full per-step detail lives in trajectory.json on disk.
   */
  private formatActionHistory(
    trajectory: Trajectory,
    config: VerifierConfig,
  ): string {
    const reasoningLimit = config.truncation.actionHistoryReasoning;
    const history = trajectory.steps
      .map((s, i) => {
        const argSummary = summarizeArgs(s.actionArgs);
        const reasoning = (s.reasoning ?? "").slice(0, reasoningLimit);
        const url = s.probeEvidence.url ? ` @ ${s.probeEvidence.url}` : "";
        return `Step ${i}: ${s.actionName}(${argSummary})${url}${reasoning ? `\n  reasoning: ${reasoning}` : ""}`;
      })
      .join("\n");
    return clampToTokenBudget(history, config.actionHistoryTokenBudget);
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

/** FIFO concurrency limiter; avoids a new dep. */
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

/**
 * Always-attach final visual evidence: the trajectory's terminal page
 * observation plus the last step's probe screenshot, deduped. Returned in
 * chronological order (last-step probe first if both are present, then
 * finalObservation as the closing frame).
 *
 * This bypasses the per-criterion top-K relevance ranking used by
 * {@link fusedJudgment} and the (previously) text-only outcome prompt, so the
 * judge LLM always sees what the page actually looked like at the end of the
 * run — not just whatever images happened to rank well against keyword
 * heuristics.
 */
function selectFinalImages(trajectory: Trajectory): EvidenceImage[] {
  const out: EvidenceImage[] = [];
  const seen = new Set<string>();

  const push = (label: string, bytes: Buffer | undefined): void => {
    if (!bytes || bytes.length === 0) return;
    const key = `${bytes.length}:${bytes.subarray(0, 32).toString("base64")}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ label, bytes, mediaType: "image/png" });
  };

  const lastStepIdx = trajectory.steps.length - 1;
  if (lastStepIdx >= 0) {
    push(
      `step ${lastStepIdx} probe screenshot (final action)`,
      trajectory.steps[lastStepIdx].probeEvidence.screenshot,
    );
  }
  push("trajectory final observation", trajectory.finalObservation?.screenshot);

  return out;
}

/**
 * Always-attach final textual evidence: the terminal page content (URL +
 * ariaTree) at the end of the run. Prefers `trajectory.finalObservation`
 * (the explicit post-run probe) and falls back to the last step's
 * `probeEvidence`. Clamped to {@link FINAL_STATE_ARIA_CHARS}.
 *
 * Returns an empty string when no terminal observation is available — the
 * caller should treat the resulting prompt section as "(no final state
 * captured)" rather than omit the header entirely so the LLM doesn't think
 * the field is missing.
 */
function buildFinalStateBlock(trajectory: Trajectory): string {
  const last = trajectory.steps[trajectory.steps.length - 1];
  const sources: Array<{
    label: string;
    url?: string;
    ariaTree?: string;
  }> = [];

  if (last?.probeEvidence) {
    sources.push({
      label: `Last step (Step ${trajectory.steps.length - 1}, post-action)`,
      url: last.probeEvidence.url,
      ariaTree: last.probeEvidence.ariaTree,
    });
  }
  if (trajectory.finalObservation) {
    sources.push({
      label: "Final observation (probed after trajectory ended)",
      url: trajectory.finalObservation.url,
      ariaTree: trajectory.finalObservation.ariaTree,
    });
  }

  if (sources.length === 0) return "(no final state captured)";

  return sources
    .map((s) => {
      const aria =
        s.ariaTree && s.ariaTree.length > FINAL_STATE_ARIA_CHARS
          ? `${s.ariaTree.slice(0, FINAL_STATE_ARIA_CHARS)}\n...[truncated ${s.ariaTree.length - FINAL_STATE_ARIA_CHARS} chars]`
          : (s.ariaTree ?? "(no aria tree)");
      const url = s.url ? `\n  url: ${s.url}` : "";
      return `${s.label}:${url}\n  aria_tree:\n${aria}`;
    })
    .join("\n\n");
}

function selectRecentImages(
  trajectory: Trajectory,
  limit: number,
): EvidenceImage[] {
  if (limit <= 0) return [];

  const images: EvidenceImage[] = [];
  const seen = new Set<string>();

  for (let i = trajectory.steps.length - 1; i >= 0; i--) {
    const step = trajectory.steps[i];
    const candidates: EvidenceImage[] = [];
    if (step.probeEvidence.screenshot) {
      candidates.push({
        label: `step ${i} probe screenshot`,
        bytes: step.probeEvidence.screenshot,
        mediaType: "image/png",
      });
    }
    for (const modality of step.agentEvidence.modalities) {
      if (modality.type === "image") {
        candidates.push({
          label: `step ${i} agent image`,
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

function currentDateForVerifier(): string {
  return new Date().toISOString().slice(0, 10);
}

const OUTCOME_KEYWORD_STOPWORDS = new Set([
  "about",
  "above",
  "access",
  "agent",
  "also",
  "answer",
  "available",
  "based",
  "been",
  "being",
  "browser",
  "class",
  "click",
  "correct",
  "current",
  "details",
  "final",
  "find",
  "found",
  "from",
  "have",
  "including",
  "into",
  "list",
  "located",
  "model",
  "more",
  "navigated",
  "page",
  "provided",
  "request",
  "requested",
  "results",
  "search",
  "show",
  "successfully",
  "task",
  "that",
  "the",
  "their",
  "then",
  "there",
  "this",
  "through",
  "user",
  "using",
  "which",
  "with",
]);

function outcomeKeywords(text: string): string[] {
  const counts = new Map<string, number>();
  for (const match of text.toLowerCase().matchAll(/[a-z0-9][a-z0-9._/-]*/g)) {
    const word = match[0].replace(/^[-_./]+|[-_./]+$/g, "");
    if (!word) continue;
    if (OUTCOME_KEYWORD_STOPWORDS.has(word)) continue;
    if (word.length < 4 && !/\d/.test(word)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, 36)
    .map(([word]) => word)
    .sort((a, b) => b.length - a.length || a.localeCompare(b));
}

function bestOutcomeExcerpt(
  text: string,
  keywords: string[],
  maxChars: number,
): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= maxChars) return compact;

  const lower = compact.toLowerCase();
  let bestIndex = -1;
  for (const keyword of keywords) {
    const idx = lower.indexOf(keyword);
    if (idx >= 0) {
      bestIndex = idx;
      break;
    }
  }

  if (bestIndex < 0) {
    return `${compact.slice(0, maxChars)}... [truncated]`;
  }

  const before = Math.floor(maxChars * 0.35);
  const start = Math.max(0, bestIndex - before);
  const end = Math.min(compact.length, start + maxChars);
  const prefix = start > 0 ? "... " : "";
  const suffix = end < compact.length ? " ... [truncated]" : "";
  return `${prefix}${compact.slice(start, end)}${suffix}`;
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

function filterByTaskSpan(
  items: z.infer<typeof RubricItemSchema>[],
  taskInstruction: string,
  logger: (line: LogLine) => void,
): z.infer<typeof RubricItemSchema>[] {
  const normalizedTask = normalizeForSpanMatch(taskInstruction);
  const kept: z.infer<typeof RubricItemSchema>[] = [];
  const dropped: { criterion: string; reason: string }[] = [];

  for (const item of items) {
    const span = item.task_span?.trim();
    if (!span) {
      dropped.push({
        criterion: item.criterion,
        reason: "missing task_span",
      });
      continue;
    }

    if (
      span === "<critical-point>" ||
      normalizedTask.includes(normalizeForSpanMatch(span))
    ) {
      kept.push(item);
      continue;
    }

    dropped.push({
      criterion: item.criterion,
      reason: `task_span ${JSON.stringify(span)} not found in task instruction`,
    });
  }

  if (dropped.length > 0) {
    logger({
      category: "v3-evaluator",
      message: "rubric: dropped hallucinated criteria via task_span filter",
      auxiliary: {
        droppedCount: { value: String(dropped.length), type: "integer" },
        dropped: {
          value: JSON.stringify(dropped),
          type: "object",
        },
      },
    });
  }

  return kept;
}

function normalizeForSpanMatch(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
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
