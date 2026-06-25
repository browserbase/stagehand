import { normalizeRubric, type TaskSpec } from "@browserbasehq/stagehand";

import { defineBenchTask } from "../../../framework/defineTask.js";
import {
  evaluationResultToSuccess,
  runWithVerifier,
} from "../../../framework/verifierAdapter.js";

/**
 * OdysseysBench bench task.
 *
 * OdysseysBench (https://odysseysbench.com) is a 200-task web-agent benchmark
 * (45 easy / 46 medium / 109 hard). Every task ships a weighted rubric, baked
 * into `precomputed_rubric` by scripts/build-odysseysbench-dataset.ts, so the
 * verifier scores process + outcome against the published criteria directly.
 *
 * Runs the agent through TrajectoryRecorder + V3Evaluator.verify() like the
 * other rubric-bearing suites (WebTailBench).
 *
 * --success knob: defaults to "outcome".
 * Override via the EVAL_SUCCESS_MODE env var: outcome | process | both.
 */
export default defineBenchTask(
  { name: "agent/odysseysbench" },
  async ({ v3, logger, debugUrl, sessionUrl, modelName, input }) => {
    try {
      const params = ((input && input.params) || {}) as {
        task_id?: string;
        confirmed_task?: string;
        website?: string;
        level?: "easy" | "medium" | "hard";
        reference_length?: number;
        precomputed_rubric?: unknown;
      };

      if (!params.confirmed_task) {
        return {
          _success: false,
          error: `Missing odysseysbench params (confirmed_task). Got: ${JSON.stringify(params)}`,
          debugUrl,
          sessionUrl,
          logs: logger.getLogs(),
        };
      }

      const page = v3.context.pages()[0];
      const startUrl = params.website || "https://www.google.com";
      await page.goto(startUrl, { timeoutMs: 120_000 });

      const systemPrompt = `You are a helpful assistant that must solve the task by browsing. At the end, produce a single line: "Final Answer: <answer>" summarizing the requested result (e.g., score, list, or text). Current page: ${await page.title()}. You will need to navigate to the appropriate website to complete the task.`;
      const agentMode = input.agentMode ?? (input.isCUA ? "cua" : "hybrid");
      const agent = v3.agent({
        mode: agentMode,
        model: modelName,
        systemPrompt,
      });

      const taskSpec: TaskSpec = {
        id: params.task_id ?? `odysseysbench/${input.name}`,
        instruction: params.confirmed_task,
        initUrl: startUrl,
        precomputedRubric: normalizeRubric(params.precomputed_rubric),
      };

      const { evaluationResult, trajectory, trajectoryDir, rubric } =
        await runWithVerifier({
          v3,
          agent,
          taskSpec,
          dataset: "odysseysbench",
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
        level: params.level,
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
