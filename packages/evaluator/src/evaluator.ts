import {
  AISdkJudge,
  createModel,
  resolveModelName,
  type LLMClient,
  type LogLine,
  type CompletionRequest,
} from "./client.js";
import { RubricVerifier } from "./rubricVerifier.js";
import type { EvaluationResult, TaskSpec, Trajectory, VerifierConfig } from "./types.js";
import { detectBrowserUse, executionIssues } from "./diagnostics.js";
import { disclosedFallback, environmentBlocked, goalUnachievable } from "./outcomeChecks.js";
import { normalizeRubric } from "./trajectory.js";

export interface EvaluatorOptions {
  modelName?: string;
  client?: LLMClient;
  rubricClient?: LLMClient;
  logger?: (line: LogLine) => void;
  config?: Partial<VerifierConfig>;
  onUsage?: (usage: unknown) => void;
}

/** Process-wide cache of successful judge health checks, keyed by model id. */
const VALIDATED_MODELS = new Map<string, Promise<void>>();

/** A malformed precomputed rubric surfaces as a verification health error, not a throw from here. */
function hasValidRubric(rubric: unknown): boolean {
  try {
    return normalizeRubric(rubric) !== undefined;
  } catch {
    return false;
  }
}

export class Evaluator {
  readonly modelName: string;
  private readonly verifier: RubricVerifier;
  private readonly options: EvaluatorOptions;

  constructor(options: EvaluatorOptions = {}) {
    this.modelName = options.modelName ?? resolveModelName();
    this.options = options;
    // Clients are created lazily: constructing an Evaluator must not require credentials (harness
    // setup, offline tooling, tests); the first validate()/verify() call resolves them and fails loud.
    this.verifier = new RubricVerifier({
      getClient: () => this.client,
      getRubricGenClient: () => this.rubricClient,
      logger: options.logger,
      config: options.config,
    });
  }

  private _client?: LLMClient;
  private _rubricClient?: LLMClient;
  private get client(): LLMClient {
    return (this._client ??=
      this.options.client ?? new AISdkJudge(createModel(this.modelName), this.options.onUsage));
  }
  private get rubricClient(): LLMClient {
    return (this._rubricClient ??=
      this.options.rubricClient ??
      (process.env.VERIFIER_RUBRIC_MODEL
        ? new AISdkJudge(createModel(process.env.VERIFIER_RUBRIC_MODEL), this.options.onUsage)
        : this.client));
  }

  /** Health-checks the judge and the rubric-generation model. */
  async validate(): Promise<void> {
    await this.check([this.client, this.rubricClient]);
  }

  private async check(clients: LLMClient[]): Promise<void> {
    for (const client of new Set(clients)) {
      if (!(client instanceof AISdkJudge)) continue;
      // One health check per model per process: harnesses construct an Evaluator per task, and a
      // per-task check adds an LLM call and latency to every row without new information. A failed
      // check is not cached, so a transient failure is retried by the next caller.
      const key = client.modelId;
      let check = VALIDATED_MODELS.get(key);
      if (!check) {
        check = client.validate();
        VALIDATED_MODELS.set(key, check);
        check.catch(() => VALIDATED_MODELS.delete(key));
      }
      await check;
    }
  }

  async verify(trajectory: Trajectory): Promise<EvaluationResult> {
    // The rubric model is only called to generate a missing rubric or the opt-in requirement checklist.
    const config = this.verifier.config;
    const usesRubricModel =
      config.approach !== "outcome-only" &&
      (!hasValidRubric(trajectory.task.precomputedRubric) || config.requirementChecklist);
    await this.check(usesRubricModel ? [this.client, this.rubricClient] : [this.client]);
    const errors: Array<{ stage: string; message: string }> = [];
    const track = (client: LLMClient): LLMClient => ({
      async createChatCompletion<T>(request: CompletionRequest): Promise<T> {
        try {
          const response = await client.createChatCompletion<T>(request);
          // generateRubric retries: a recovered attempt is not an evaluator error.
          if (request.options.response_model.name === "Rubric") {
            for (let i = errors.length - 1; i >= 0; i--)
              if (errors[i].stage === "Rubric") errors.splice(i, 1);
          }
          return response;
        } catch (error) {
          errors.push({
            stage: request.options.response_model.name,
            message: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
      },
    });
    const verifier = new RubricVerifier({
      getClient: () => track(this.client),
      getRubricGenClient: () => track(this.rubricClient),
      logger: this.options.logger,
      config: this.options.config,
    });
    let result: EvaluationResult;
    try {
      result = await verifier.verify(trajectory);
    } catch (error) {
      if (!errors.length)
        errors.push({
          stage: "verification",
          message: error instanceof Error ? error.message : String(error),
        });
      result = { outcomeSuccess: false, outcomeState: "unresolved" };
    }
    const rubric = trajectory.task.precomputedRubric;
    if (
      rubric &&
      hasValidRubric(rubric) &&
      verifier.config.approach !== "outcome-only" &&
      result.perCriterion?.length !== rubric.items.length
    ) {
      errors.push({ stage: "criterion-coverage", message: "Missing criterion scores" });
    }
    const fatal = errors.some((e) => e.stage !== "BatchedRelevance");
    result.health = {
      schemaVersion: 1,
      status: errors.length ? (fatal ? "error" : "degraded") : "healthy",
      errors,
    };
    if (errors.length || !result.outcomeState) {
      result.outcomeState = "unresolved";
      result.outcomeSuccess = false;
    }
    const issues = executionIssues(trajectory);
    // Judge established from recorded site state that no agent could achieve the goal (item not
    // sold, out of stock, online purchase not offered). Outcome still fails; downstream excludes
    // the row from capability scores, like an environment blocker.
    if (!result.outcomeSuccess && goalUnachievable(result.outcomeChecks))
      issues.push({ failureClass: "goal_unachievable", source: "judge" });
    // Blockers visible only in page content (login walls, CAPTCHAs, error pages) leave no tool
    // error; the judge reports them so the row is classified environment, not capability.
    if (
      !result.outcomeSuccess &&
      environmentBlocked(result.outcomeChecks) &&
      !issues.some((x) => x.failureClass === "site_blocked")
    )
      issues.push({ failureClass: "site_blocked", source: "judge" });
    if (disclosedFallback(result.outcomeChecks)) result.outcomeCategory = "disclosed_fallback";
    result.execution = {
      terminationReason: trajectory.terminationReason,
      issues,
      browserUse: detectBrowserUse(trajectory.steps),
    };
    result.failureClass = issues[0]?.failureClass;
    this.options.logger?.({
      category: "verifier",
      message: "verifier health and browser-use rule",
      level: 1,
      auxiliary: {
        health: { type: "object", value: result.health },
        execution: { type: "object", value: result.execution },
      },
    });
    return result;
  }

  async generateRubric(task: TaskSpec) {
    await this.check([this.rubricClient]);
    return this.verifier.generateRubric(task);
  }
}
