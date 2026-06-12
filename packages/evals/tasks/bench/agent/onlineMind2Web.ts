import type { TaskSpec } from "@browserbasehq/stagehand";

import { defineBenchTask } from "../../../framework/defineTask.js";
import {
  runWithVerifier,
  evaluationResultToSuccess,
} from "../../../framework/verifierAdapter.js";

/**
 * OnlineMind2Web bench task.
 *
 * Runs through TrajectoryRecorder + V3Evaluator.verify(). Unlike WebTailBench,
 * Mind2Web doesn't ship rubrics; the verifier generates one on first encounter
 * per task id and caches under packages/evals/.rubric-cache/onlineMind2Web/.
 * Cached rubrics hydrate on subsequent runs.
 *
 * --success knob: defaults to "outcome".
 * Override via the EVAL_SUCCESS_MODE env var (set by the bench runner's
 * --success flag): outcome | process | both.
 */
export default defineBenchTask(
  { name: "agent/onlineMind2Web" },
  async ({ v3, logger, debugUrl, sessionUrl, modelName, input }) => {
    try {
      const params = ((input && input.params) || {}) as {
        task_id?: string;
        confirmed_task?: string;
        website?: string;
        reference_length?: number;
        level?: string;
      };

      if (!params.website || !params.confirmed_task) {
        return {
          _success: false,
          error: `Missing onlineMind2Web params (website, confirmed_task). Got: ${JSON.stringify(params)}`,
          debugUrl,
          sessionUrl,
          logs: logger.getLogs(),
        };
      }

      const page = v3.context.pages()[0];
      await page.goto(params.website, { timeoutMs: 120_000 });

      const systemPrompt = `You are a helpful assistant that must solve the task by browsing. At the end, produce a single line: "Final Answer: <answer>" summarizing the requested result (e.g., score, list, or text). Current page: ${await page.title()}. ALWAYS OPERATE WITHIN THE PAGE OPENED BY THE USER, WHICHEVER TASK YOU ARE ATTEMPTING TO COMPLETE CAN BE ACCOMPLISHED WITHIN THE PAGE.`;
      const agentMode = input.agentMode ?? (input.isCUA ? "cua" : "hybrid");
      const agent = v3.agent({
        mode: agentMode,
        model: modelName,
        systemPrompt,
      });

      const taskSpec: TaskSpec = {
        id: params.task_id ?? `onlineMind2Web/${input.name}`,
        instruction: params.confirmed_task,
        initUrl: params.website,
        // No precomputedRubric; RubricCache will generate one for this task id,
        // then hydrate from cache on subsequent runs.
      };

      const { evaluationResult, trajectory, trajectoryDir, rubric } =
        await runWithVerifier({
          v3,
          agent,
          taskSpec,
          dataset: "onlineMind2Web",
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

      const raw = evaluationResult.rawSteps;

      return {
        _success: evaluationResultToSuccess(evaluationResult, successMode),
        outcomeSuccess: evaluationResult.outcomeSuccess,
        processScore: evaluationResult.processScore,
        evidenceInsufficient: evaluationResult.evidenceInsufficient,
        criterionCount: rubric.items.length,
        stepCount: trajectory.steps.length,
        trajectoryDir,
        rubricSource: raw?.rubricSource,
        primaryIntent: raw?.primaryIntent,
        reasoning: raw?.reasoning,
        // Keep task_level in the return for any consumer that depends on it
        // (matches the pre-migration shape).
        task_level: params.level,
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
        task_level: ((input.params as { level?: string } | undefined) ?? {})
          .level,
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
