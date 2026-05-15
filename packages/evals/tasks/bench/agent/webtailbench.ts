import {
  normalizeRubric,
  type Rubric,
  type SerializedRubric,
  type TaskSpec,
} from "@browserbasehq/stagehand";

import { defineBenchTask } from "../../../framework/defineTask.js";
import {
  runWithVerifier,
  verdictToSuccess,
} from "../../../framework/verifierAdapter.js";

/**
 * WebTailBench bench task.
 *
 * Wave 1 MVP: runs the agent through the new TrajectoryRecorder +
 * V3Evaluator.verify() pipeline (process + outcome scoring grounded in the
 * paper's MMRubricAgent). The previous polling-based ScreenshotCollector +
 * V3Evaluator.ask() flow is gone.
 *
 * The local WebTailBench JSONL doesn't carry precomputed_rubric (the
 * upstream HF dataset does — Wave 2 dataset swap pending). Until then the
 * verifier generates a rubric via Step 0a on first encounter per task id
 * and caches under packages/evals/.rubric-cache/webtailbench/.
 *
 * --success knob: defaults to "outcome" (matches fara-7b's reported metric).
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
        precomputed_rubric?: Rubric | SerializedRubric;
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

      const { verdict, trajectory, trajectoryDir, rubric } =
        await runWithVerifier({
          v3,
          agent,
          taskSpec,
          dataset: "webtailbench",
          agentOptions: {
            maxSteps: Number(process.env.AGENT_EVAL_MAX_STEPS) || 50,
          },
        });

      const successMode =
        (process.env.EVAL_SUCCESS_MODE as "outcome" | "process" | "both") ||
        "outcome";

      logger.log({
        category: "evaluation",
        message: `verdict: outcome=${verdict.outcomeSuccess} process=${verdict.processScore.toFixed(2)} criteria=${rubric.items.length} steps=${trajectory.steps.length}`,
        level: 1,
      });

      return {
        _success: verdictToSuccess(verdict, successMode),
        outcomeSuccess: verdict.outcomeSuccess,
        processScore: verdict.processScore,
        evidenceInsufficient: verdict.evidenceInsufficient,
        criterionCount: rubric.items.length,
        stepCount: trajectory.steps.length,
        trajectoryDir,
        primaryIntent: verdict.rawSteps?.primaryIntent,
        reasoning: verdict.rawSteps?.reasoning,
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
