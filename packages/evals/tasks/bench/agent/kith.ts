import type { TaskSpec } from "@browserbasehq/stagehand";

import { defineBenchTask } from "../../../framework/defineTask.js";
import { adHocRubric } from "../../../framework/adHocRubric.js";
import {
  runWithVerifier,
  evaluationResultToSuccess,
} from "../../../framework/verifierAdapter.js";

export default defineBenchTask(
  { name: "agent/kith" },
  async ({ debugUrl, sessionUrl, logger, agent, v3 }) => {
    try {
      const initUrl =
        "https://kith.com/collections/nike-air-force-1/products/nkcw2288-111?variant=19439468707968";
      const page = v3.context.pages()[0];
      await page.goto(initUrl);

      const instruction =
        "Add the shoes to cart, go to checkout, fill the delivery information, then fill the credit card information using placeholders. Do not submit the order.";

      const taskSpec: TaskSpec = {
        id: "agent/kith",
        instruction,
        initUrl,
        precomputedRubric: adHocRubric(
          "Did the agent fill the delivery information?",
          "Did the agent fill the payment information?",
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
