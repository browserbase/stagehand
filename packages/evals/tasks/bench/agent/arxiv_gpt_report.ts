// agent often fails on this one
import type { TaskSpec } from "@browserbasehq/stagehand";

import { defineBenchTask } from "../../../framework/defineTask.js";
import { adHocRubric } from "../../../framework/adHocRubric.js";
import {
  runWithVerifier,
  evaluationResultToSuccess,
} from "../../../framework/verifierAdapter.js";

export default defineBenchTask(
  { name: "agent/arxiv_gpt_report" },
  async ({ debugUrl, sessionUrl, logger, agent, v3 }) => {
    try {
      const initUrl = "https://arxiv.org/";
      const page = v3.context.pages()[0];
      await page.goto(initUrl);

      const instruction =
        "Find the paper 'GPT-4 Technical Report', when was v3 submitted?";
      // Mon, 27 Mar 2023 17:46:54 UTC
      const expected = "03-27-2023";

      const taskSpec: TaskSpec = {
        id: "agent/arxiv_gpt_report",
        instruction,
        initUrl,
        expectedAnswer: expected,
        precomputedRubric: adHocRubric(
          `did the agent complete this task successfully? ${instruction} The correct answer is '${expected}'.`,
        ),
      };

      const { evaluationResult, trajectoryDir } = await runWithVerifier({
        v3,
        agent,
        taskSpec,
        dataset: "agent-custom",
        agentOptions: {
          maxSteps: Number(process.env.AGENT_EVAL_MAX_STEPS) || 25,
        },
      });

      const successMode = process.env.EVAL_SUCCESS_MODE;

      return {
        _success: evaluationResultToSuccess(evaluationResult, successMode),
        outcomeSuccess: evaluationResult.outcomeSuccess,
        processScore: evaluationResult.processScore,
        trajectoryDir,
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
    } finally {
      await v3.close();
    }
  },
);
