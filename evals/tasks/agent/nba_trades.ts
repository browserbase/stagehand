import { EvalFunction } from "@/types/evals";
import { Evaluator } from "@/evals/evaluator";
export const nba_trades: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
  agent,
}) => {
  try {
    const evaluator = new Evaluator(stagehand);
    await stagehand.page.goto("https://www.espn.com/");

    const agentResult = await agent.execute({
      instruction:
        "Find the latest Team transaction in the NBA within the past week.",
      maxSteps: Number(process.env.AGENT_EVAL_MAX_STEPS) || 25,
    });
    logger.log(agentResult);

    const { evaluation, reasoning } = await evaluator.ask({
      question: "Did the agent make it to the nba transactions page?",
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
