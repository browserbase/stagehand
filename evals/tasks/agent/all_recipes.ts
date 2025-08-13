import { EvalFunction } from "@/types/evals";

export const all_recipes: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
  agent,
}) => {
  try {
    await stagehand.page.goto("https://www.allrecipes.com/");

    const agentResult = await agent.execute({
      instruction:
        "Search for a recipe for Beef Wellington on Allrecipes that has at least 200 reviews and an average rating of 4.5 stars or higher. List the main ingredients required for the dish.",
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
