import type { TaskSpec } from "@browserbasehq/stagehand";

import { defineBenchTask } from "../../../framework/defineTask.js";
import { adHocRubric } from "../../../framework/adHocRubric.js";
import {
  runWithVerifier,
  verdictToSuccess,
} from "../../../framework/verifierAdapter.js";

export default defineBenchTask(
  { name: "agent/github" },
  async ({ debugUrl, sessionUrl, logger, agent, v3 }) => {
    try {
      const initUrl = "https://github.com/";
      const page = v3.context.pages()[0];
      await page.goto(initUrl);

      const instruction =
        "Find a Ruby repository on GitHub that has been updated in the past 3 days and has at least 1000 stars.";

      const taskSpec: TaskSpec = {
        id: "agent/github",
        instruction,
        initUrl,
        precomputedRubric: adHocRubric(
          "Ruby repository on GitHub that has been updated in the past 3 days and has at least 1000 stars.",
        ),
      };

      const { verdict, trajectoryDir } = await runWithVerifier({
        v3,
        agent,
        taskSpec,
        dataset: "agent-custom",
        agentOptions: {
          maxSteps: Number(process.env.AGENT_EVAL_MAX_STEPS) || 20,
        },
      });

      const successMode =
        (process.env.EVAL_SUCCESS_MODE as "outcome" | "process" | "both") ||
        "outcome";

      return {
        _success: verdictToSuccess(verdict, successMode),
        outcomeSuccess: verdict.outcomeSuccess,
        processScore: verdict.processScore,
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
