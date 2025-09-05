import { EvalFunction } from "@/types/evals";
import { Evaluator } from "@/evals/evaluator";

export const kayak: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
  agent,
}) => {
  try {
    const evaluator = new Evaluator(stagehand);
    await stagehand.page.goto("https://www.kayak.com");

    await agent.execute({
      instruction: "Find flights from San Francisco to Tokyo next week",
      maxSteps: Number(process.env.AGENT_EVAL_MAX_STEPS) || 25,
    });
    await agent.execute({
      instruction: "Sort the flights by price",
      maxSteps: Number(process.env.AGENT_EVAL_MAX_STEPS) || 8,
    });

    if (stagehand.context.pages().length !== 2) {
      return {
        _success: false,
        message: "No new pages were opened",
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }
    const { evaluation, reasoning } = await evaluator.ask({
      question:
        "Are the flights shown sorted by price? Check the sort button in the top left corner of the page. It should show cheapest first; use this as the success criteria since the page might promote other flights and not show the list in order.",
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
      message: error.message,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } finally {
    await stagehand.close();
  }
};
