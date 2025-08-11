import { EvalFunction } from "@/types/evals";

export const hotel_booking: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
  modelName,
}) => {
  try {
    await stagehand.page.goto("https://www.booking.com/");

    const agent = stagehand.agent({
      model: modelName,
      provider: modelName.startsWith("claude") ? "anthropic" : "openai",
      instructions: `You are a helpful assistant that can help me with my tasks. You are given a task and you need to complete it without asking follow up questions. The current page is ${await stagehand.page.title()}`,
    });

    const agentResult = await agent.execute({
      instruction:
        "Find a hotel in Sydney with a rating of 8 or higher, providing free Wi-Fi and parking, available for a four-night stay starting on December 10, 2025.",
      maxSteps: 20,
    });
    logger.log(agentResult);

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
      error,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    } as unknown as ReturnType<EvalFunction> extends Promise<infer R>
      ? R
      : never;
  } finally {
    await stagehand.close();
  }
};
