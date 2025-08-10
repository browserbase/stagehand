import { EvalFunction } from "@/types/evals";

export const wolframalpha_weight_loss: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
}) => {
  try {
    await stagehand.page.goto("https://www.wolframalpha.com/");
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
        "Weight lose for a male with current weight 90 kg, 40 year old, 175 cm. If he intakes 1500 calories every day, how long will it take to lose 17 kg.",
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
