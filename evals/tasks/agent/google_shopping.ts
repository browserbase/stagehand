import { EvalFunction } from "@/types/evals";

export const google_shopping: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
  modelName,
}) => {
  try {
    await stagehand.page.goto("https://www.google.com/shopping");

    const agent = stagehand.agent({
      model: modelName,
      provider: modelName.startsWith("claude") ? "anthropic" : "openai",
      instructions: `You are a helpful assistant that can help me with my tasks. You are given a task and you need to complete it without asking follow up questions. The current page is ${await stagehand.page.title()}`,
    });

    const agentResult = await agent.execute({
      instruction:
        "Create a list of drip coffee makers that are on sale and within $25-60 and have a black finish.",
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
