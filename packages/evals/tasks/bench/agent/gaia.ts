import type { TaskSpec } from "@browserbasehq/stagehand";

import { defineBenchTask } from "../../../framework/defineTask.js";
import { adHocRubric } from "../../../framework/adHocRubric.js";
import {
  runWithVerifier,
  evaluationResultToSuccess,
} from "../../../framework/verifierAdapter.js";

/**
 * Data-driven GAIA agent eval.
 *
 * Per-test params (injected via the eval runner):
 *   { id, level, web, ques, expected? }
 *
 * Starts at `web`, runs the agent with `ques` as the instruction. The
 * verifier scores against a single criterion that checks the final answer
 * against `expected` when present; otherwise falls back to a generic
 * "did the agent complete this task?" criterion.
 */
export default defineBenchTask(
  { name: "agent/gaia" },
  async ({ v3, logger, debugUrl, sessionUrl, modelName, input }) => {
    try {
      const params = ((input && input.params) || {}) as {
        id?: string;
        level?: number;
        web?: string;
        ques?: string;
        expected?: string;
      };

      if (!params.web || !params.ques) {
        logger.error({
          category: "gaia",
          level: 0,
          message: `Missing GAIA params (web, ques).`,
          auxiliary: {
            params: { value: JSON.stringify(params), type: "object" },
          },
        });
        return {
          _success: false,
          error: `Missing GAIA params (web, ques). Got: ${JSON.stringify(params)}`,
          debugUrl,
          sessionUrl,
          logs: logger.getLogs(),
        };
      }

      const page = v3.context.pages()[0];
      await page.goto(params.web);

      const systemPrompt = `You are a helpful assistant that must solve the task by browsing. You must produce a single line at the end like: "Final Answer: <answer>". Do not ask follow up questions. Current page: ${await page.title()}`;
      const agentMode = input.agentMode ?? (input.isCUA ? "cua" : "hybrid");
      const agent = v3.agent({
        mode: agentMode,
        model: modelName,
        systemPrompt,
      });

      const criterion = params.expected
        ? `Did the agent's final answer match the expected answer: "${params.expected}"?`
        : `did the agent complete this task successfully? ${params.ques}`;

      const taskSpec: TaskSpec = {
        id: params.id ?? `gaia/${input.name}`,
        instruction: params.ques,
        initUrl: params.web,
        expectedAnswer: params.expected,
        precomputedRubric: adHocRubric(criterion),
      };

      const { evaluationResult, trajectoryDir } = await runWithVerifier({
        v3,
        agent,
        taskSpec,
        dataset: "gaia",
        agentOptions: {
          maxSteps: Number(process.env.AGENT_EVAL_MAX_STEPS) || 50,
        },
      });

      const successMode = process.env.EVAL_SUCCESS_MODE;

      return {
        _success: evaluationResultToSuccess(evaluationResult, successMode),
        outcomeSuccess: evaluationResult.outcomeSuccess,
        processScore: evaluationResult.processScore,
        expectedAnswer: params.expected,
        trajectoryDir,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } catch (error) {
      const trajectoryDir = (error as { trajectoryDir?: string }).trajectoryDir;
      logger.error({
        category: "gaia",
        level: 0,
        message: `Unhandled error in GAIA task`,
        auxiliary: {
          error: {
            value: error instanceof Error ? error.message : String(error),
            type: "string",
          },
        },
      });
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
