import { EvalFunction } from "@/types/evals";
import { Evaluator } from "@/evals/evaluator";
export const github: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
  agent,
}) => {
  try {
    await stagehand.page.goto("https://github.com/");
    const evaluator = new Evaluator(stagehand);
    const agentResult = await agent.execute({
      instruction:
        "Find a Ruby repository on GitHub that has been updated in the past 3 days and has at least 1000 stars.",
      maxSteps: Number(process.env.AGENT_EVAL_MAX_STEPS) || 20,
    });
    logger.log(agentResult);

    const { evaluation, reasoning } = await evaluator.ask({
      question:
        "Ruby repository on GitHub that has been updated in the past 3 days and has at least 1000 stars.",
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
