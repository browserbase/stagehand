import { EvalFunction } from "../../types/evals";
import { V3Evaluator } from "@browserbasehq/stagehand";

export const github_react_version: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  logger,
  v3,
  v3Agent,
}) => {
  try {
    const page = v3.context.pages()[0];
    const evaluator = new V3Evaluator(v3);
    await page.goto("https://github.com/");
    await v3Agent.execute({
      instruction:
        "Check the latest release version of React and the date it was published. ",
      maxSteps: Number(process.env.AGENT_EVAL_MAX_STEPS) || 20,
    });
    const { evaluation, reasoning } = await evaluator.ask({
      question:
        "Does the page show the latest version of react and the date it was published",
    });
    logger.log({
      message: "Evaluation results",
      level: 1,
      auxiliary: {
        evaluation: { value: evaluation, type: "string" },
        reasoning: { value: reasoning, type: "string" },
      },
    });
    // only use url check for now, as using extract on the version is prone to breaking in future
    const success = evaluation === "YES";
    if (!success) {
      return {
        _success: false,
        message: reasoning,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }
    return {
      _success: true,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } catch (error) {
    return {
      _success: false,
      message: error.message,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } finally {
    await v3.close();
  }
};
