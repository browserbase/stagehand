import { EvalFunction } from "@/types/evals";

export const youtube: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
  modelName,
}) => {
  try {
    await stagehand.page.goto("https://youtube.com");

    const agent = stagehand.agent({
      model: modelName,
      provider: modelName.startsWith("claude") ? "anthropic" : "openai",
      instructions: `You are a helpful assistant that can help me with my tasks. You are given a task and you need to complete it without asking follow up questions. The current page is ${await stagehand.page.title()}`,
    });

    const agentResult = await agent.execute({
      instruction:
        "Search for Keinemusik's set under some very famous pointy landmarks",
      maxSteps: 15,
    });
    logger.log(agentResult);
    const url = await stagehand.page.url();

    if (url.includes("https://www.youtube.com/watch?v=eEobh8iCbIE")) {
      return {
        _success: true,
        observations: url,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }

    return {
      _success: false,
      observations: url,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } catch (error) {
    return {
      _success: false,
      error: error,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } finally {
    await stagehand.close();
  }
};
