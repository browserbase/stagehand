import { EvalFunction } from "../../types/evals";
import { V3Evaluator } from "@browserbasehq/stagehand";

export const google_shopping: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  logger,
  agent,
  v3,
}) => {
  try {
    const page = v3.context.pages()[0];
    await page.goto("https://www.google.com/shopping");

    const agentResult = await agent.execute({
      instruction:
        "Find a drip coffee maker that is on sale and within $25-60 and has a black finish",
      maxSteps: Number(process.env.AGENT_EVAL_MAX_STEPS) || 20,
    });
    logger.log(agentResult);

    const evaluator = new V3Evaluator(v3);
    const { evaluation, reasoning } = await evaluator.ask({
      question:
        "Does the page show a drip coffee maker that is on sale and within $25-60 and has a black finish?",
    });

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
      error,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } finally {
    await v3.close();
  }
};
