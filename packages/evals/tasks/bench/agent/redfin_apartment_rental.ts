import type { TaskSpec } from "@browserbasehq/stagehand";

import { defineBenchTask } from "../../../framework/defineTask.js";
import { adHocRubric } from "../../../framework/adHocRubric.js";
import {
  runWithVerifier,
  evaluationResultToSuccess,
} from "../../../framework/verifierAdapter.js";

export default defineBenchTask(
  { name: "agent/redfin_apartment_rental" },
  async ({ debugUrl, sessionUrl, logger, agent, v3 }) => {
    try {
      const initUrl = "https://redfin.com/";
      const page = v3.context.pages()[0];
      await page.goto(initUrl);

      // Move-in date 30 days from now.
      const moveInDate = new Date();
      moveInDate.setDate(moveInDate.getDate() + 30);
      const moveInDateFormatted = moveInDate.toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });

      const instruction = `Find a 2 bed and 1.5+ bath apartment listing for rent in New York, with a move in date of ${moveInDateFormatted}. use https://redfin.com/ to achieve the task. Don't go to any other site. The task is achievable with just navigation from this site.`;

      const taskSpec: TaskSpec = {
        id: "agent/redfin_apartment_rental",
        instruction,
        initUrl,
        precomputedRubric: adHocRubric(
          `did the agent complete this task successfully? ${instruction}`,
        ),
      };

      const { evaluationResult, trajectoryDir } = await runWithVerifier({
        v3,
        agent,
        taskSpec,
        dataset: "agent-custom",
        agentOptions: {
          maxSteps: Number(process.env.AGENT_EVAL_MAX_STEPS) || 40,
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
