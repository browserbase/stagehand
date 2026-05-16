import type { TaskSpec } from "@browserbasehq/stagehand";

import { defineBenchTask } from "../../../framework/defineTask.js";
import { adHocRubric } from "../../../framework/adHocRubric.js";
import {
  runWithVerifier,
  evaluationResultToSuccess,
} from "../../../framework/verifierAdapter.js";

export default defineBenchTask(
  { name: "agent/sf_library_card" },
  async ({ debugUrl, sessionUrl, logger, agent, v3 }) => {
    try {
      const initUrl = "https://sflib1.sfpl.org/selfreg";
      const page = v3.context.pages()[0];
      await page.goto(initUrl);

      const instruction =
        "Fill in the 'street Address' field with '166 Geary St'";

      const taskSpec: TaskSpec = {
        id: "agent/sf_library_card",
        instruction,
        initUrl,
        precomputedRubric: adHocRubric(
          "Does the page show the 'street Address' field filled with '166 Geary St'?",
        ),
      };

      const { evaluationResult, trajectoryDir } = await runWithVerifier({
        v3,
        agent,
        taskSpec,
        dataset: "agent-custom",
        agentOptions: {
          maxSteps: Number(process.env.AGENT_EVAL_MAX_STEPS) || 1,
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
