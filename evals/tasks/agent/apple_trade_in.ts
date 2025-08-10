import { EvalFunction } from "@/types/evals";

export const apple_trade_in: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
}) => {
  try {
    await stagehand.page.goto("https://www.apple.com/");
    const agent = stagehand.agent({
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      instructions: `You are a helpful web automation assistant. DON'T ASK FOLLOW UP QUESTIONS UNTIL YOU HAVE FULFILLED THE USER'S REQUEST. Today is ${new Date().toLocaleDateString()}.`,
      options: {
        apiKey: process.env.ANTHROPIC_API_KEY,
      },
    });

    const agentResult = await agent.execute({
      instruction:
        "Find out the trade-in value for an iPhone 13 Pro Max in good condition on the Apple website.",
      maxSteps: 30,
    });

    const success = agentResult.success;

    if (!success) {
      return {
        _success: false,
        message: agentResult.message,
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
