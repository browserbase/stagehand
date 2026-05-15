import type { TaskSpec } from "@browserbasehq/stagehand";

import { defineBenchTask } from "../../../framework/defineTask.js";
import {
  runWithVerifier,
  verdictToSuccess,
} from "../../../framework/verifierAdapter.js";

/**
 * WebVoyager bench task.
 *
 * Wave 1 MVP: runs through the new TrajectoryRecorder + V3Evaluator.verify()
 * pipeline. WebVoyager doesn't ship precomputed rubrics, so the verifier
 * generates one via Step 0a on first encounter per task id and caches under
 * packages/evals/.rubric-cache/webvoyager/.
 *
 * --success knob: defaults to "outcome" (matches fara-7b's reported metric).
 * Override via the EVAL_SUCCESS_MODE env var: outcome | process | both.
 */
export default defineBenchTask(
  { name: "agent/webvoyager" },
  async ({ v3, logger, debugUrl, sessionUrl, modelName, input }) => {
    try {
      const params = ((input && input.params) || {}) as {
        id?: string;
        web?: string;
        ques?: string;
        web_name?: string;
      };

      if (!params.web || !params.ques) {
        return {
          _success: false,
          error: `Missing WebVoyager params (web, ques). Got: ${JSON.stringify(params)}`,
          debugUrl,
          sessionUrl,
          logs: logger.getLogs(),
        };
      }

      const page = v3.context.pages()[0];
      await page.goto(params.web, { timeoutMs: 120_000 });

      const systemPrompt = `You are a helpful assistant that must solve the task by browsing. At the end, produce a single line: "Final Answer: <answer>" summarizing the requested result (e.g., score, list, or text). Current page: ${await page.title()}`;
      const agentMode = input.agentMode ?? (input.isCUA ? "cua" : "hybrid");
      const agent = v3.agent({
        mode: agentMode,
        model: modelName,
        systemPrompt,
      });

      const taskSpec: TaskSpec = {
        id: params.id ?? `webvoyager/${input.name}`,
        instruction: params.ques,
        initUrl: params.web,
        // No precomputedRubric — RubricCache generates via Step 0a on first
        // encounter, then hydrates from cache on subsequent runs.
      };

      const { verdict, trajectory, trajectoryDir, rubric } =
        await runWithVerifier({
          v3,
          agent,
          taskSpec,
          dataset: "webvoyager",
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

      const raw = verdict.rawSteps as
        | { primaryIntent?: string; reasoning?: string; rubricSource?: string }
        | undefined;

      return {
        _success: verdictToSuccess(verdict, successMode),
        outcomeSuccess: verdict.outcomeSuccess,
        processScore: verdict.processScore,
        evidenceInsufficient: verdict.evidenceInsufficient,
        criterionCount: rubric.items.length,
        stepCount: trajectory.steps.length,
        trajectoryDir,
        rubricSource: raw?.rubricSource,
        primaryIntent: raw?.primaryIntent,
        reasoning: raw?.reasoning,
        webName: params.web_name,
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
