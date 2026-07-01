import {
  AgentProvider,
  getAISDKLanguageModel,
  loadApiKeyFromEnv,
  providerEnvVarMap,
  V3,
  type AgentInstance,
  type AvailableModel,
  type LLMClient,
  type LogLine,
  type TaskSpec,
} from "@browserbasehq/stagehand";
import { AISdkClientWrapped } from "../lib/AISdkClientWrapped.js";
import { endBrowserbaseSession } from "../browserbaseCleanup.js";
import { EvalsError } from "../errors.js";
import type { EvalLogger } from "../logger.js";
import type { V3InitResult } from "../initV3.js";
import type { EvalInput } from "../types/evals.js";
import type { ExternalHarnessTaskPlan } from "./externalHarnessPlan.js";
import {
  runClaudeCodeAgent,
  type ClaudeCodeVerifierConfig,
} from "./claudeCodeRunner.js";
import { prepareClaudeCodeToolAdapter } from "./claudeCodeToolAdapter.js";
import { runCodexAgent } from "./codexRunner.js";
import { prepareCodexToolAdapter } from "./codexToolAdapter.js";
import { buildExternalHarnessTaskPlan } from "./externalHarnessPlan.js";
import type { DiscoveredTask, TaskResult } from "./types.js";
import type { BenchMatrixRow, BenchTaskKind, Harness } from "./benchTypes.js";

type Page = ReturnType<V3["context"]["pages"]>[number];

export interface BenchHarnessStartInput {
  task: DiscoveredTask;
  input: EvalInput;
  row: BenchMatrixRow;
  logger: EvalLogger;
  verbose?: boolean;
}

export interface BenchHarnessExecuteInput extends BenchHarnessStartInput {
  signal?: AbortSignal;
}

export interface BenchHarnessContext {
  harness: Harness;
  row: BenchMatrixRow;
  logger: EvalLogger;
  v3?: V3;
  agent?: AgentInstance;
  page?: Page;
  debugUrl: string;
  sessionUrl: string;
}

export interface StartedBenchHarness {
  ctx: BenchHarnessContext;
  cleanup: () => Promise<void>;
}

export interface BenchHarness {
  harness: Harness;
  supportedTaskKinds: BenchTaskKind[];
  supportsApi: boolean;
  execute?(input: BenchHarnessExecuteInput): Promise<TaskResult>;
  start(input: BenchHarnessStartInput): Promise<StartedBenchHarness>;
}

function isAgentTask(task: DiscoveredTask): boolean {
  return (
    task.primaryCategory === "agent" ||
    task.categories.includes("agent") ||
    task.categories.includes("external_agent_benchmarks")
  );
}

function resolveProvider(modelName: AvailableModel): string | undefined {
  if (modelName.includes("/")) {
    return modelName.split("/")[0];
  }

  try {
    return AgentProvider.getAgentProvider(modelName);
  } catch {
    return undefined;
  }
}

export const stagehandHarness: BenchHarness = {
  harness: "stagehand",
  supportedTaskKinds: [
    "act",
    "extract",
    "observe",
    "agent",
    "combination",
    "suite",
  ],
  supportsApi: true,
  async start({
    task,
    input,
    row,
    logger,
    verbose,
  }: BenchHarnessStartInput): Promise<StartedBenchHarness> {
    let v3Result: V3InitResult | undefined;
    const createAgent = isAgentTask(task);
    if (row.config.harness !== "stagehand") {
      throw new EvalsError(
        `Harness "${row.config.harness}" is not implemented yet. Use --harness stagehand for the current unified runner.`,
      );
    }
    const config = row.config;
    const agentMode = config.agentMode ?? input.agentMode;
    const isCUA = config.isCUA ?? input.isCUA;

    if (config.useApi) {
      const provider = resolveProvider(input.modelName);
      const logFn = (line: LogLine) => logger.log(line);
      const apiKey = loadApiKeyFromEnv(provider, logFn);
      if (!apiKey) {
        throw new EvalsError(
          `USE_API=true but no API key found for provider "${provider}".`,
        );
      }
      const { initV3 } = await import("../initV3.js");
      v3Result = await initV3({
        logger,
        modelName: input.modelName,
        modelClientOptions: { apiKey },
        createAgent,
        agentMode,
        isCUA,
        verbose,
        configOverrides: { env: config.environment },
      });
    } else {
      let llmClient: LLMClient | undefined;
      if (input.modelName.includes("/")) {
        const firstSlashIndex = input.modelName.indexOf("/");
        llmClient = new AISdkClientWrapped({
          model: getAISDKLanguageModel(
            input.modelName.substring(0, firstSlashIndex),
            input.modelName.substring(firstSlashIndex + 1),
          ),
        });
      }
      const { initV3 } = await import("../initV3.js");
      v3Result = await initV3({
        logger,
        llmClient,
        modelName: input.modelName,
        createAgent,
        agentMode,
        isCUA,
        verbose,
        configOverrides: { env: config.environment },
      });
    }

    return {
      ctx: {
        harness: "stagehand",
        row,
        logger,
        v3: v3Result.v3,
        agent: v3Result.agent,
        page: v3Result.v3.context.pages()[0],
        debugUrl: v3Result.debugUrl ?? "",
        sessionUrl: v3Result.sessionUrl ?? "",
      },
      cleanup: async () => {
        if (v3Result?.v3) {
          try {
            await v3Result.v3.close();
          } catch (closeError) {
            console.error(
              `Warning: Error closing V3 instance for ${input.name}:`,
              closeError,
            );
          }
        }
        await endBrowserbaseSession(v3Result?.v3);
      },
    };
  },
};

/**
 * Default judge model for the claude_code rubric verifier — used for both rubric
 * generation and scoring. google/gemini-2.5-flash is V3Evaluator's own tuned
 * default and reliably emits the verifier's structured-output schema; smaller
 * models (e.g. anthropic/claude-haiku-4-5) intermittently fail the fused
 * judgment call ("response did not match schema"), which the verifier reports as
 * evidenceInsufficient → spurious outcome=false. Override with
 * EVAL_CLAUDE_CODE_VERIFIER_MODEL (the judge's provider key is auto-resolved).
 * Requires GEMINI_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY for the default.
 */
const CLAUDE_CODE_VERIFIER_JUDGE_MODEL = "google/gemini-2.5-flash";

/**
 * Whether the rubric verifier should run for claude_code. Default ON so browse
 * runs get ground-truth scoring; set EVAL_CLAUDE_CODE_VERIFIER to 0/false/off to
 * fall back to the agent's self-reported EVAL_RESULT line.
 */
function isClaudeCodeVerifierEnabled(): boolean {
  const raw = process.env.EVAL_CLAUDE_CODE_VERIFIER;
  if (raw === undefined) return true;
  const normalized = raw.trim().toLowerCase();
  return !(
    normalized === "0" ||
    normalized === "false" ||
    normalized === "off" ||
    normalized === "no"
  );
}

/**
 * Build the ClaudeCodeVerifierConfig that wires V3Evaluator's rubric verifier
 * into the claude_code runner. Returns undefined (→ self-report fallback) when
 * the verifier is disabled or when constructing the V3 carrier throws — never
 * crashes the run. Exception: an explicit judge override
 * (EVAL_CLAUDE_CODE_VERIFIER_MODEL) whose provider key can't be resolved throws
 * a config error rather than silently downgrading to self-report.
 *
 * The V3 instance is used ONLY as the LLM-client carrier for V3Evaluator; per
 * ClaudeCodeVerifierConfig it does NOT need init(). We mirror `evals verify`
 * (tui/commands/verify.ts): a browser-free V3 with disableAPI + an Anthropic
 * model so the verifier's LLMProvider resolves against ANTHROPIC_API_KEY.
 */
function buildClaudeCodeVerifierConfig(
  plan: ExternalHarnessTaskPlan,
  logger: EvalLogger,
): ClaudeCodeVerifierConfig | undefined {
  if (!isClaudeCodeVerifierEnabled()) return undefined;

  const judgeModelOverride = process.env.EVAL_CLAUDE_CODE_VERIFIER_MODEL;
  const judgeModel = (judgeModelOverride ||
    CLAUDE_CODE_VERIFIER_JUDGE_MODEL) as AvailableModel;

  // Resolve the judge provider's key so V3Evaluator sends the RIGHT credential.
  // Without this it defaults modelClientOptions.apiKey to the Gemini key, which
  // an Anthropic judge would receive as x-api-key → "invalid x-api-key".
  const judgeProvider = judgeModel.includes("/")
    ? judgeModel.slice(0, judgeModel.indexOf("/"))
    : undefined;
  const judgeApiKey = judgeProvider
    ? loadApiKeyFromEnv(judgeProvider, (line: LogLine) => logger.log(line))
    : undefined;
  const judgeClientOptions = judgeApiKey ? { apiKey: judgeApiKey } : undefined;

  // Fail fast on a judge OVERRIDE whose key we can't resolve, so it propagates
  // instead of being swallowed into the self-report fallback. Otherwise
  // V3Evaluator backfills modelClientOptions with the Gemini key, hands the
  // wrong provider its credential, verify() throws, and the run silently
  // downgrades to legacy self-report. Surface the misconfiguration instead.
  //
  // Only providers that genuinely require a key qualify: `loadApiKeyFromEnv`
  // returns undefined for key-requiring providers (missing key) AND for
  // API-keyless providers (ollama, bedrock — no entry in providerEnvVarMap) by
  // design. Mirror that set via providerEnvVarMap so keyless judges proceed
  // with no explicit apiKey instead of being rejected as misconfigured. The
  // built-in default (gemini) is also exempt: it degrades gracefully to
  // V3Evaluator's own key resolution.
  const judgeProviderRequiresKey =
    judgeProvider !== undefined && judgeProvider in providerEnvVarMap;
  if (judgeModelOverride && judgeProviderRequiresKey && !judgeApiKey) {
    throw new EvalsError(
      `EVAL_CLAUDE_CODE_VERIFIER_MODEL="${judgeModel}" was set but no API key resolved for provider "${judgeProvider}". Set that provider's key (e.g. ANTHROPIC_API_KEY / OPENAI_API_KEY) or unset EVAL_CLAUDE_CODE_VERIFIER_MODEL to use the default judge.`,
    );
  }

  try {
    // Browser-free carrier — no init(). Only v3.logger is read by V3Evaluator.
    const v3 = new V3({
      env: "LOCAL",
      verbose: 0,
      disableAPI: true,
      model: judgeClientOptions
        ? { modelName: judgeModel, ...judgeClientOptions }
        : judgeModel,
      logger: (line: LogLine) => logger.log(line),
    });

    const taskSpec: TaskSpec = {
      // Fallback id feeds the trajectory dir path, so sanitize the
      // instruction-derived segment — raw instruction text can contain `/`,
      // `..`, or other path-unsafe characters that would fork the output dir.
      id:
        plan.taskId ??
        `${plan.dataset}/${plan.instruction
          .slice(0, 40)
          .replace(/[^A-Za-z0-9_-]/g, "_")}`,
      instruction: plan.instruction,
      initUrl: plan.startUrl,
      ...(plan.precomputedRubric && {
        precomputedRubric: plan.precomputedRubric,
      }),
      ...(plan.expectedAnswer && { expectedAnswer: plan.expectedAnswer }),
    };

    return {
      v3,
      taskSpec,
      dataset: plan.dataset,
      judgeModel,
      judgeClientOptions,
      successMode: process.env.EVAL_SUCCESS_MODE as
        | "outcome"
        | "process"
        | "both"
        | undefined,
    };
  } catch (error) {
    logger.warn({
      category: "claude_code",
      message: `verifier setup skipped (falling back to self-report): ${
        error instanceof Error ? error.message : String(error)
      }`,
      level: 0,
    });
    return undefined;
  }
}

export const claudeCodeHarness: BenchHarness = {
  harness: "claude_code",
  supportedTaskKinds: ["agent", "suite"],
  supportsApi: false,
  async execute({
    input,
    row,
    logger,
    signal,
  }: BenchHarnessExecuteInput): Promise<TaskResult> {
    const plan = buildExternalHarnessTaskPlan(input);
    if (row.config.harness !== "claude_code") {
      throw new EvalsError(
        `Expected claude_code harness config, received "${row.config.harness}".`,
      );
    }
    const toolAdapter = await prepareClaudeCodeToolAdapter({
      toolSurface: row.config.toolSurface,
      startupProfile: row.config.startupProfile,
      environment: row.config.environment,
      plan,
      logger,
    });
    try {
      // Built inside the try so a fail-fast verifier-config error (e.g. an
      // override judge whose key can't be resolved) still runs the finally that
      // owns the prepared tool adapter, instead of leaking it.
      const verifier = buildClaudeCodeVerifierConfig(plan, logger);
      return await runClaudeCodeAgent({
        plan,
        model: input.modelName,
        logger,
        toolAdapter,
        signal,
        verifier,
      });
    } finally {
      await toolAdapter.cleanup();
    }
  },
  async start(): Promise<StartedBenchHarness> {
    throw new EvalsError(
      "Claude Code harness execution uses the external harness execute path. Use --dry-run to inspect its bench matrix, or run with --harness claude_code.",
    );
  },
};

export const codexHarness: BenchHarness = {
  harness: "codex",
  supportedTaskKinds: ["agent", "suite"],
  supportsApi: false,
  async execute({
    input,
    row,
    logger,
    signal,
  }: BenchHarnessExecuteInput): Promise<TaskResult> {
    const plan = buildExternalHarnessTaskPlan(input);
    if (row.config.harness !== "codex") {
      throw new EvalsError(
        `Expected codex harness config, received "${row.config.harness}".`,
      );
    }
    const toolAdapter = await prepareCodexToolAdapter({
      toolSurface: row.config.toolSurface,
      startupProfile: row.config.startupProfile,
      environment: row.config.environment,
      plan,
      logger,
    });
    try {
      return await runCodexAgent({
        plan,
        model: input.modelName,
        logger,
        toolAdapter,
        signal,
      });
    } finally {
      await toolAdapter.cleanup();
    }
  },
  async start(): Promise<StartedBenchHarness> {
    throw new EvalsError(
      "Codex harness execution uses the external harness execute path. Use --dry-run to inspect its bench matrix, or run with --harness codex.",
    );
  },
};

const harnessRegistry = new Map<Harness, BenchHarness>([
  ["stagehand", stagehandHarness],
  ["claude_code", claudeCodeHarness],
  ["codex", codexHarness],
]);

export function getBenchHarness(harness: Harness): BenchHarness {
  const implementation = harnessRegistry.get(harness);
  if (!implementation) {
    throw new EvalsError(
      `Harness "${harness}" is not implemented yet. Use --harness stagehand for the current unified runner.`,
    );
  }
  return implementation;
}
