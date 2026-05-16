import type { TaskSpec } from "@browserbasehq/stagehand";

import { defineBenchTask } from "../../../framework/defineTask.js";
import { adHocRubric } from "../../../framework/adHocRubric.js";
import {
  runWithVerifier,
  evaluationResultToSuccess,
} from "../../../framework/verifierAdapter.js";

export default defineBenchTask(
  { name: "agent/google_maps_3" },
  async ({ debugUrl, sessionUrl, logger, agent, v3 }) => {
    try {
      const initUrl = "https://maps.google.com/";
      const page = v3.context.pages()[0];
      await page.goto(initUrl);

      const instruction =
        "Search for locksmiths open now but not open 24 hours in Texas City.";

      const taskSpec: TaskSpec = {
        id: "agent/google_maps_3",
        instruction,
        initUrl,
        precomputedRubric: adHocRubric(
          "Does the page show a locksmiths open now but not open 24 hours in Texas City?",
        ),
      };

      const { evaluationResult, trajectoryDir } = await runWithVerifier({
        v3,
        agent,
        taskSpec,
        dataset: "agent-custom",
        agentOptions: {
          maxSteps: Number(process.env.AGENT_EVAL_MAX_STEPS) || 35,
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
