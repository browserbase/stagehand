//this eval is expected to fail due to issues scrolling within the trade in dialog
import { EvalFunction } from "@/types/evals";
import { Evaluator } from "../../evaluator";

export const apple_trade_in: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
  agent,
}) => {
  try {
    await stagehand.page.goto("https://www.apple.com/shop/trade-in");
    const evaluator = new Evaluator(stagehand);
    await agent.execute({
      instruction:
        "Find out the trade-in value for an iPhone 13 Pro Max in good condition on the Apple website.",
      maxSteps: Number(process.env.AGENT_EVAL_MAX_STEPS) || 35,
    });

    const { evaluation, reasoning } = await evaluator.ask({
      question:
        "Did the agent find the trade-in value for an iPhone 13 Pro Max in good condition on the Apple website?",
      screenshot: false,
      answer: "360",
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
