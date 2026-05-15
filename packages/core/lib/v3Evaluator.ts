import type { AvailableModel, ClientOptions } from "./v3/types/public/model.js";
import type {
  EvaluateOptions,
  BatchAskOptions,
  EvaluationResult,
} from "./v3/types/private/evaluator.js";
import { V3 } from "./v3/v3.js";
import { StagehandInvalidArgumentError } from "./v3/types/public/sdkErrors.js";
import { LegacyV3Evaluator } from "./v3LegacyEvaluator.js";
import type {
  Trajectory,
  TaskSpec,
  Verdict,
  Rubric,
  Verifier,
  AgentEvidenceModality,
  VerifierFinding,
} from "./v3/verifier/index.js";

const EVALUATOR_BACKEND_ENV = "STAGEHAND_EVALUATOR_BACKEND";
const DEFAULT_EVALUATOR_BACKEND: V3EvaluatorBackend = "legacy";

export type V3EvaluatorBackend = "legacy" | "verifier";

export type V3EvaluatorOptions = {
  /**
   * Selects the evaluator implementation.
   *
   * "legacy" preserves the existing screenshot/text YES/NO evaluator.
   * "verifier" is reserved for the rubric verifier backend.
   *
   * @default process.env.STAGEHAND_EVALUATOR_BACKEND || "legacy"
   */
  backend?: V3EvaluatorBackend;
};

export type V3EvaluatorConstructorOptions = V3EvaluatorOptions & {
  modelName?: AvailableModel;
  modelClientOptions?: ClientOptions;
};

type NormalizedConstructorOptions = {
  modelName?: AvailableModel;
  modelClientOptions?: ClientOptions;
  backend?: V3EvaluatorBackend;
};

export class V3Evaluator implements Verifier {
  private readonly backend: V3EvaluatorBackend;
  private readonly legacyEvaluator: LegacyV3Evaluator;

  constructor(
    v3: V3,
    modelNameOrOptions?: AvailableModel | V3EvaluatorConstructorOptions,
    modelClientOptions?: ClientOptions,
    options?: V3EvaluatorOptions,
  ) {
    const normalizedOptions = normalizeConstructorOptions(
      modelNameOrOptions,
      modelClientOptions,
      options,
    );

    this.backend = resolveEvaluatorBackend(normalizedOptions.backend);
    this.legacyEvaluator = new LegacyV3Evaluator(
      v3,
      normalizedOptions.modelName,
      normalizedOptions.modelClientOptions,
    );
  }

  async ask(options: EvaluateOptions): Promise<EvaluationResult> {
    return this.getLegacyBackend("ask").ask(options);
  }

  async batchAsk(options: BatchAskOptions): Promise<EvaluationResult[]> {
    return this.getLegacyBackend("batchAsk").batchAsk(options);
  }

  async verify(trajectory: Trajectory, taskSpec: TaskSpec): Promise<Verdict> {
    assertVerifierInput(trajectory, taskSpec);

    if (this.backend === "legacy") {
      return this.verifyTrajectoryWithLegacyEvaluator(trajectory, taskSpec);
    }

    return this.unavailableVerifierBackend("verify");
  }

  async generateRubric(taskSpec: TaskSpec): Promise<Rubric> {
    if (!taskSpec?.id) {
      throw new StagehandInvalidArgumentError(
        "TaskSpec.id is required for rubric generation",
      );
    }

    if (this.backend === "verifier") {
      return this.unavailableVerifierBackend("generateRubric");
    }

    return {
      items: [legacyTaskCompletionCriterion(taskSpec)],
    };
  }

  private getLegacyBackend(methodName: string): LegacyV3Evaluator {
    if (this.backend === "legacy") {
      return this.legacyEvaluator;
    }

    return this.unavailableVerifierBackend(methodName);
  }

  private unavailableVerifierBackend(methodName: string): never {
    throw new StagehandInvalidArgumentError(
      `V3Evaluator.${methodName}() was configured with ${EVALUATOR_BACKEND_ENV}=verifier, but the verifier backend is not available in this build. Use "legacy" or install the verifier backend PR.`,
    );
  }

  private async verifyTrajectoryWithLegacyEvaluator(
    trajectory: Trajectory,
    taskSpec: TaskSpec,
  ): Promise<Verdict> {
    const screenshots = collectLegacyScreenshots(trajectory);
    const agentReasoning = renderLegacyAgentReasoning(trajectory);
    const answer = trajectory.finalAnswer;

    if (!screenshots.length && !answer) {
      return legacyInsufficientEvidenceVerdict(
        taskSpec,
        "Legacy evaluator compatibility mode had no screenshots or final answer to evaluate.",
      );
    }

    const result = await this.legacyEvaluator.ask({
      question: taskSpec.instruction,
      screenshot: screenshots.length ? screenshots : false,
      answer,
      agentReasoning,
    });

    return legacyEvaluationToVerdict(result, taskSpec, screenshots.length);
  }
}

function normalizeConstructorOptions(
  modelNameOrOptions?: AvailableModel | V3EvaluatorConstructorOptions,
  modelClientOptions?: ClientOptions,
  options?: V3EvaluatorOptions,
): NormalizedConstructorOptions {
  if (
    modelNameOrOptions &&
    typeof modelNameOrOptions === "object" &&
    !Array.isArray(modelNameOrOptions)
  ) {
    return {
      modelName: modelNameOrOptions.modelName,
      modelClientOptions: modelNameOrOptions.modelClientOptions,
      backend: modelNameOrOptions.backend ?? options?.backend,
    };
  }

  return {
    modelName: modelNameOrOptions as AvailableModel | undefined,
    modelClientOptions,
    backend: options?.backend,
  };
}

function resolveEvaluatorBackend(
  explicitBackend?: V3EvaluatorBackend,
): V3EvaluatorBackend {
  const configuredBackend =
    explicitBackend ??
    process.env[EVALUATOR_BACKEND_ENV] ??
    DEFAULT_EVALUATOR_BACKEND;
  const normalizedBackend = configuredBackend.trim().toLowerCase();

  if (normalizedBackend === "legacy" || normalizedBackend === "verifier") {
    return normalizedBackend;
  }

  throw new StagehandInvalidArgumentError(
    `Invalid ${EVALUATOR_BACKEND_ENV}="${configuredBackend}". Expected "legacy" or "verifier".`,
  );
}

function assertVerifierInput(trajectory: Trajectory, taskSpec: TaskSpec): void {
  if (!taskSpec?.id) {
    throw new StagehandInvalidArgumentError(
      "TaskSpec.id is required for verification",
    );
  }
  if (!trajectory) {
    throw new StagehandInvalidArgumentError(
      "Trajectory is required for verification",
    );
  }
}

function legacyTaskCompletionCriterion(taskSpec: TaskSpec) {
  return {
    criterion: "legacy-task-completion",
    description: `Evaluate whether the task was completed successfully: ${taskSpec.instruction}`,
    maxPoints: 1,
  };
}

function collectLegacyScreenshots(trajectory: Trajectory): Buffer[] {
  const screenshots: Buffer[] = [];

  for (const step of trajectory.steps ?? []) {
    if (Buffer.isBuffer(step.probeEvidence?.screenshot)) {
      screenshots.push(step.probeEvidence.screenshot);
      continue;
    }

    const agentImage = step.agentEvidence?.modalities?.find(
      (
        modality,
      ): modality is Extract<AgentEvidenceModality, { type: "image" }> =>
        modality.type === "image" && Buffer.isBuffer(modality.bytes),
    );

    if (agentImage) {
      screenshots.push(agentImage.bytes);
    }
  }

  return screenshots;
}

function renderLegacyAgentReasoning(
  trajectory: Trajectory,
): string | undefined {
  const stepLines = (trajectory.steps ?? []).map((step) => {
    const output = step.toolOutput?.error
      ? `Tool error: ${step.toolOutput.error}`
      : `Tool output: ${stringifyForPrompt(step.toolOutput?.result)}`;
    return [
      `Step ${step.index}: ${step.actionName}`,
      step.reasoning ? `Reasoning: ${step.reasoning}` : undefined,
      output,
    ]
      .filter(Boolean)
      .join("\n");
  });

  const sections = [
    stepLines.length
      ? `Agent trajectory:\n${stepLines.join("\n\n")}`
      : undefined,
    trajectory.finalAnswer
      ? `Final answer:\n${trajectory.finalAnswer}`
      : undefined,
  ].filter(Boolean);

  if (!sections.length) {
    return undefined;
  }

  return truncateForPrompt(sections.join("\n\n"), 16000);
}

function stringifyForPrompt(value: unknown): string {
  if (typeof value === "string") {
    return truncateForPrompt(value, 2000);
  }

  try {
    return truncateForPrompt(JSON.stringify(value), 2000);
  } catch {
    return String(value);
  }
}

function truncateForPrompt(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}... [truncated]`;
}

function legacyEvaluationToVerdict(
  result: EvaluationResult,
  taskSpec: TaskSpec,
  screenshotCount: number,
): Verdict {
  const outcomeSuccess = result.evaluation === "YES";
  const invalid = result.evaluation === "INVALID";
  const criterion = legacyTaskCompletionCriterion(taskSpec);
  const findings: VerifierFinding[] = invalid
    ? [
        {
          category: "verifier_uncertainty",
          severity: "warning",
          description: result.reasoning,
        },
      ]
    : [];

  return {
    outcomeSuccess,
    processScore: outcomeSuccess ? 1 : 0,
    perCriterion: [
      {
        criterion: criterion.criterion,
        maxPoints: criterion.maxPoints,
        earnedPoints: outcomeSuccess ? 1 : 0,
        justification: result.reasoning,
        evidenceInsufficient: invalid,
      },
    ],
    taskValidity: {
      isAmbiguous: false,
      isInvalid: false,
    },
    evidenceInsufficient: invalid ? [criterion.criterion] : [],
    findings,
    rawSteps: {
      backend: "legacy",
      legacyEvaluation: result.evaluation,
      screenshotCount,
    },
  };
}

function legacyInsufficientEvidenceVerdict(
  taskSpec: TaskSpec,
  reason: string,
): Verdict {
  const criterion = legacyTaskCompletionCriterion(taskSpec);

  return {
    outcomeSuccess: false,
    processScore: 0,
    perCriterion: [
      {
        criterion: criterion.criterion,
        maxPoints: criterion.maxPoints,
        earnedPoints: 0,
        justification: reason,
        evidenceInsufficient: true,
      },
    ],
    taskValidity: {
      isAmbiguous: false,
      isInvalid: false,
    },
    evidenceInsufficient: [criterion.criterion],
    findings: [
      {
        category: "trajectory_capture",
        severity: "blocking",
        description: reason,
      },
    ],
    rawSteps: {
      backend: "legacy",
      legacyEvaluation: "INVALID",
      screenshotCount: 0,
    },
  };
}
