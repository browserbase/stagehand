import type { TaskSpec } from "@browserbasehq/stagehand";

import { defineBenchTask } from "../../../framework/defineTask.js";
import { adHocRubric } from "../../../framework/adHocRubric.js";
import {
  runWithVerifier,
  evaluationResultToSuccess,
} from "../../../framework/verifierAdapter.js";

export default defineBenchTask(
  { name: "agent/apple_trade_in" },
  async ({ debugUrl, sessionUrl, logger, agent, v3 }) => {
    try {
      const initUrl = "https://www.apple.com/shop/trade-in";
      const page = v3.context.pages()[0];
      await page.goto(initUrl);

      const instruction =
        "Find out the trade-in value for an iPhone 13 Pro Max in good condition on the Apple website.";

      const taskSpec: TaskSpec = {
        id: "agent/apple_trade_in",
        instruction,
        initUrl,
        precomputedRubric: adHocRubric(
          "Did the agent find the trade-in value for an iPhone 13 Pro Max in good condition on the Apple website?",
        ),
      };

      const { evaluationResult, trajectoryDir } = await runWithVerifier({
        v3,
        agent,
        taskSpec,
        dataset: "agent-custom",
        agentOptions: {
          maxSteps: Number(process.env.AGENT_EVAL_MAX_STEPS) || 30,
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
