import { EvalFunction } from "@/types/evals";

export const wolframalpha_weight_loss: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
  agent,
}) => {
  try {
    await stagehand.page.goto("https://www.wolframalpha.com/");

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
