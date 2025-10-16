import { Evaluator } from "@/evals/evaluator";
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
    const evaluator = new Evaluator(stagehand);
    const agentResult = await agent.execute({
      instruction:
        "Search for a recipe for Beef Wellington on Allrecipes that has at least 200 reviews and an average rating of 4.5 stars or higher. List the main ingredients required for the dish.",
      maxSteps: Number(process.env.AGENT_EVAL_MAX_STEPS) || 40,
    });

    const { evaluation, reasoning } = await evaluator.ask({
      question: "Did the agent find a recipe for Beef Wellington",
    });

    logger.log(agentResult);

    const success =
      evaluation === "YES" &&
      stagehand.page.url() ===
        "https://www.allrecipes.com/recipe/16899/beef-wellington/";

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
      error,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } finally {
    await stagehand.close();
  }
};
