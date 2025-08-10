import { EvalFunction } from "@/types/evals";
import { Evaluator } from "@/evals/evaluator";

export const ubereats: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
}) => {
  try {
    const evaluator = new Evaluator(stagehand);
    await stagehand.page.goto("https://www.ubereats.com/");
    const agent = stagehand.agent({
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      instructions: `You are a helpful assistant that can help me order food from ubereats. DON'T ASK FOLLOW UP QUESTIONS UNTIL YOU HAVE FULFILLED THE USER'S REQUEST. Today is ${new Date().toLocaleDateString()}.`,
      options: {
        apiKey: process.env.ANTHROPIC_API_KEY,
      },
    });
    await agent.execute({
      instruction:
        "Order a pizza from ubereats to 639 geary st in sf, call the task complete once the login page is shown after adding pizza and viewing the cart",
      maxSteps: 30,
    });

    const { evaluation, reasoning } = await evaluator.evaluate({
      question: "Did the agent make it to the login page?",
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
