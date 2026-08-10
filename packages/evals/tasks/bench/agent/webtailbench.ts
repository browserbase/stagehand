import { normalizeRubric, type TaskSpec } from "@browserbasehq/stagehand";

import { defineBenchTask } from "../../../framework/defineTask.js";
import {
  evaluationResultToSuccess,
  runWithVerifier,
} from "../../../framework/verifierAdapter.js";

/**
 * WebTailBench bench task.
 *
 * Runs the agent through TrajectoryRecorder + V3Evaluator.verify() so process
 * and outcome scoring are grounded in saved trajectory evidence.
 *
 * If a row does not carry `precomputed_rubric`, the verifier generates a
 * rubric on first encounter per task id and caches it under
 * packages/evals/.rubric-cache/webtailbench/.
 *
 * --success knob: defaults to "outcome".
 * Override via the EVAL_SUCCESS_MODE env var: outcome | process | both.
 */
export default defineBenchTask(
  { name: "agent/webtailbench" },
  async ({ v3, logger, debugUrl, sessionUrl, modelName, input }) => {
    try {
      const params = ((input && input.params) || {}) as {
        id?: string;
        category?: string;
        ques?: string;
        web?: string;
        precomputed_rubric?: unknown;
      };

      if (!params.ques) {
        return {
          _success: false,
          error: `Missing webtailbench params (ques). Got: ${JSON.stringify(params)}`,
          debugUrl,
          sessionUrl,
          logs: logger.getLogs(),
        };
      }

      const page = v3.context.pages()[0];
      const startUrl = params.web || "https://www.google.com";
      await page.goto(startUrl, { timeoutMs: 120_000 });

      const systemPrompt = `You are a helpful assistant that must solve the task by browsing. At the end, produce a single line: "Final Answer: <answer>" summarizing the requested result (e.g., score, list, or text). Current page: ${await page.title()}. You will need to navigate to the appropriate website to complete the task.`;
      const agentMode = input.agentMode ?? (input.isCUA ? "cua" : "hybrid");
      const agent = v3.agent({
        mode: agentMode,
        model: modelName,
        systemPrompt,
      });

      const taskSpec: TaskSpec = {
        id: params.id ?? `webtailbench/${input.name}`,
        instruction: params.ques,
        initUrl: startUrl,
        precomputedRubric: normalizeRubric(params.precomputed_rubric),
      };

      const { evaluationResult, trajectory, trajectoryDir, rubric } =
        await runWithVerifier({
          v3,
          agent,
          taskSpec,
          dataset: "webtailbench",
          agentOptions: {
            maxSteps: Number(process.env.AGENT_EVAL_MAX_STEPS) || 50,
          },
        });

      const successMode = process.env.EVAL_SUCCESS_MODE;

      logger.log({
        category: "evaluation",
        message: `result: outcome=${evaluationResult.outcomeSuccess} process=${formatProcessScore(evaluationResult.processScore)} criteria=${rubric.items.length} steps=${trajectory.steps.length}`,
        level: 1,
      });

      return {
        _success: evaluationResultToSuccess(evaluationResult, successMode),
        outcomeSuccess: evaluationResult.outcomeSuccess,
        processScore: evaluationResult.processScore,
        evidenceInsufficient: evaluationResult.evidenceInsufficient,
        criterionCount: rubric.items.length,
        stepCount: trajectory.steps.length,
        trajectoryDir,
        primaryIntent: evaluationResult.rawSteps?.primaryIntent,
        reasoning: evaluationResult.rawSteps?.reasoning,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } catch (error) {
      const trajectoryDir = (error as { trajectoryDir?: string }).trajectoryDir;
      return {
        _success: false,
        error,
        trajectoryDir,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }
  },
);

function formatProcessScore(score: number | undefined): string {
  return typeof score === "number" ? score.toFixed(2) : "n/a";
}
