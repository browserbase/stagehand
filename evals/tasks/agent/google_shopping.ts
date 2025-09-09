import { Evaluator } from "@/evals/evaluator";
import { EvalFunction } from "@/types/evals";

export const google_shopping: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
  agent,
}) => {
  try {
    await stagehand.page.goto("https://www.google.com/shopping");

    const agentResult = await agent.execute({
      instruction:
        "Find a drip coffee maker that is on sale and within $25-60 and has a black finish",
      maxSteps: Number(process.env.AGENT_EVAL_MAX_STEPS) || 20,
    });
    logger.log(agentResult);

    const evaluator = new Evaluator(stagehand);
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
    await stagehand.close();
  }
};
