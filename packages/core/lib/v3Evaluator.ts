/**
 * Public V3 evaluator facade.
 *
 * The facade keeps the legacy evaluator available while the rubric verifier
 * backend is layered in separately.
 */

import type { AvailableModel, ClientOptions } from "./v3/types/public/model.js";
import type {
  EvaluateOptions,
  BatchAskOptions,
  EvaluationResult,
} from "./v3/types/private/evaluator.js";
import { V3 } from "./v3/v3.js";
import { StagehandInvalidArgumentError } from "./v3/types/public/sdkErrors.js";
import { LegacyV3Evaluator } from "./v3LegacyEvaluator.js";

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

export class V3Evaluator {
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

  private getLegacyBackend(methodName: string): LegacyV3Evaluator {
    if (this.backend === "legacy") {
      return this.legacyEvaluator;
    }

    throw new StagehandInvalidArgumentError(
      `V3Evaluator.${methodName}() was configured with ${EVALUATOR_BACKEND_ENV}=verifier, but the verifier backend is not available in this build. Use "legacy" or install the verifier backend PR.`,
    );
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
