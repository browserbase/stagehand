import { EvalFunction } from "@/types/evals";

export const github: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
  modelName,
}) => {
  try {
    await stagehand.page.goto("https://github.com/");

    const agent = stagehand.agent({
      model: modelName,
      provider: modelName.startsWith("claude") ? "anthropic" : "openai",
      instructions: `You are a helpful assistant that can help me with my tasks. You are given a task and you need to complete it without asking follow up questions. The current page is ${await stagehand.page.title()}`,
    });

    const agentResult = await agent.execute({
      instruction:
        "Find a Ruby repository on GitHub that has been updated in the past 3 days and has at least 1000 stars.",
      maxSteps: 14,
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
