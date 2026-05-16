import type { TaskSpec } from "@browserbasehq/stagehand";

import { defineBenchTask } from "../../../framework/defineTask.js";
import { adHocRubric } from "../../../framework/adHocRubric.js";
import {
  runWithVerifier,
  evaluationResultToSuccess,
} from "../../../framework/verifierAdapter.js";

export default defineBenchTask(
  { name: "agent/iframe_form" },
  async ({ debugUrl, sessionUrl, logger, agent, v3 }) => {
    try {
      const initUrl =
        "https://browserbase.github.io/stagehand-eval-sites/sites/iframe-form-filling/";
      const page = v3.context.pages()[0];
      await page.goto(initUrl);

      const instruction =
        "Fill in the form name with 'John Smith', then fill in the form email with 'john.smith@example.com'.";

      const taskSpec: TaskSpec = {
        id: "agent/iframe_form",
        instruction,
        initUrl,
        precomputedRubric: adHocRubric(
          "Is the form name input filled with 'John Smith'?",
          "Is the form email input filled with 'john.smith@example.com'?",
        ),
      };

      const { evaluationResult, trajectoryDir } = await runWithVerifier({
        v3,
        agent,
        taskSpec,
        dataset: "agent-custom",
        agentOptions: {
          maxSteps: Number(process.env.AGENT_EVAL_MAX_STEPS) || 10,
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
