import type { AvailableModel, ClientOptions } from "./v3/types/public/model.js";
import type {
  EvaluateOptions,
  BatchAskOptions,
  EvaluationResult as LegacyEvaluationResult,
} from "./v3/types/private/evaluator.js";
import { V3 } from "./v3/v3.js";
import type { LLMClient } from "./v3/llm/LLMClient.js";
import { LLMProvider } from "./v3/llm/LLMProvider.js";
import { StagehandInvalidArgumentError } from "./v3/types/public/sdkErrors.js";
import { LegacyV3Evaluator } from "./v3LegacyEvaluator.js";
import { RubricVerifier } from "./v3/verifier/rubricVerifier.js";
import type {
  Trajectory,
  TaskSpec,
  EvaluationResult,
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
  private readonly v3: V3;
  private readonly backend: V3EvaluatorBackend;
  private readonly modelName: AvailableModel;
  private readonly modelClientOptions: ClientOptions | { apiKey: string };
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
    this.v3 = v3;
    this.modelName =
      normalizedOptions.modelName ||
      ("google/gemini-2.5-flash" as AvailableModel);
    this.modelClientOptions = normalizedOptions.modelClientOptions || {
      apiKey:
        process.env.GEMINI_API_KEY ||
        process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
        "",
    };
    this.legacyEvaluator = new LegacyV3Evaluator(
      v3,
      normalizedOptions.modelName,
      normalizedOptions.modelClientOptions,
    );
  }

  async ask(options: EvaluateOptions): Promise<LegacyEvaluationResult> {
    return this.getLegacyBackend("ask").ask(options);
  }

  async batchAsk(options: BatchAskOptions): Promise<LegacyEvaluationResult[]> {
    return this.getLegacyBackend("batchAsk").batchAsk(options);
  }

  async verify(trajectory: Trajectory): Promise<EvaluationResult> {
    const taskSpec = assertVerifierInput(trajectory);

    if (this.backend === "legacy") {
      return this.verifyTrajectoryWithLegacyEvaluator(trajectory, taskSpec);
    }

    const verifier = new RubricVerifier({
      getClient: () => this.getClient(),
      getRubricGenClient: () => this.getRubricGenClient(),
    });
    return verifier.verify(trajectory);
  }

  async generateRubric(taskSpec: TaskSpec): Promise<Rubric> {
    if (!taskSpec?.id) {
      throw new StagehandInvalidArgumentError(
        "TaskSpec.id is required for rubric generation",
      );
    }

    if (this.backend === "legacy") {
      return {
        items: [legacyTaskCompletionCriterion(taskSpec)],
      };
    }

    const verifier = new RubricVerifier({
      getClient: () => this.getClient(),
      getRubricGenClient: () => this.getRubricGenClient(),
    });
    return verifier.generateRubric(taskSpec);
  }

  private getLegacyBackend(methodName: string): LegacyV3Evaluator {
    if (this.backend === "legacy") {
      return this.legacyEvaluator;
    }

    return this.unavailableVerifierBackend(methodName);
  }

  private unavailableVerifierBackend(methodName: string): never {
    throw new StagehandInvalidArgumentError(
      `V3Evaluator.${methodName}() was configured with ${EVALUATOR_BACKEND_ENV}=verifier, but the verifier backend only supports verify() and generateRubric(). Use "legacy" for ask()/batchAsk().`,
    );
  }

  private getClient(): LLMClient {
    const provider = new LLMProvider(this.v3.logger);
    return provider.getClient(this.modelName, this.modelClientOptions);
  }

  private getRubricGenClient(): LLMClient {
    const override = process.env.VERIFIER_RUBRIC_MODEL as
      | AvailableModel
      | undefined;
    if (!override) return this.getClient();

    const provider = new LLMProvider(this.v3.logger);
    const overrideProvider = override.includes("/")
      ? override.slice(0, override.indexOf("/"))
      : undefined;
    const defaultProvider = this.modelName.includes("/")
      ? this.modelName.slice(0, this.modelName.indexOf("/"))
      : undefined;
    const sameProvider =
      overrideProvider !== undefined && overrideProvider === defaultProvider;

    return provider.getClient(
      override,
      sameProvider ? this.modelClientOptions : undefined,
    );
  }

  private async verifyTrajectoryWithLegacyEvaluator(
    trajectory: Trajectory,
    taskSpec: TaskSpec,
  ): Promise<EvaluationResult> {
    const screenshots = collectLegacyScreenshots(trajectory);
    const agentReasoning = renderLegacyAgentReasoning(trajectory);
    const answer = trajectory.finalAnswer;

    if (!screenshots.length && !answer) {
      return legacyInsufficientEvidenceResult(
        "Legacy evaluator compatibility mode had no screenshots or final answer to evaluate.",
      );
    }

    const result = await this.legacyEvaluator.ask({
      question: taskSpec.instruction,
      screenshot: screenshots.length ? screenshots : false,
      answer,
      agentReasoning,
    });

    return legacyEvaluationToResult(result, screenshots.length);
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

function assertVerifierInput(trajectory: Trajectory): TaskSpec {
  if (!trajectory) {
    throw new StagehandInvalidArgumentError(
      "Trajectory is required for verification",
    );
  }
  if (!trajectory.task?.id) {
    throw new StagehandInvalidArgumentError(
      "Trajectory.task.id is required for verification",
    );
  }
  return trajectory.task;
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

  if (Buffer.isBuffer(trajectory.finalObservation?.screenshot)) {
    screenshots.push(trajectory.finalObservation.screenshot);
  }

  return screenshots;
}

function renderLegacyAgentReasoning(
  trajectory: Trajectory,
): string | undefined {
  const stepLines = (trajectory.steps ?? []).map((step, i) => {
    const status = step.toolOutput?.ok === false ? "Tool status: failed" : "";
    const output = step.toolOutput?.error
      ? `Tool error: ${step.toolOutput.error}`
      : `Tool output: ${stringifyForPrompt(step.toolOutput?.result)}`;
    return [
      `Step ${i}: ${step.actionName}`,
      step.reasoning ? `Reasoning: ${step.reasoning}` : undefined,
      status || undefined,
      output,
    ]
      .filter(Boolean)
      .join("\n");
  });

  if (!stepLines.length) {
    return undefined;
  }

  return truncateForPrompt(
    `Agent trajectory:\n${stepLines.join("\n\n")}`,
    16000,
  );
}

function stringifyForPrompt(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  try {
    const serialized = JSON.stringify(value);
    return serialized ?? String(value);
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

function legacyEvaluationToResult(
  result: LegacyEvaluationResult,
  screenshotCount: number,
): EvaluationResult {
  const outcomeSuccess = result.evaluation === "YES";
  const invalid = result.evaluation === "INVALID";
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
    explanation: result.reasoning,
    ...(findings.length ? { findings } : {}),
    rawSteps: {
      backend: "legacy",
      legacyEvaluation: result.evaluation,
      screenshotCount,
    },
  };
}

function legacyInsufficientEvidenceResult(reason: string): EvaluationResult {
  return {
    outcomeSuccess: false,
    explanation: reason,
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
