import { EvalFunction } from "@/types/evals";
import { Evaluator } from "@/evals/evaluator";
export const steam_games: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
  agent,
}) => {
  try {
    await stagehand.page.goto("https://store.steampowered.com/");

    agent.execute({
      instruction:
        "Show most played games in Steam. And tell me the number of players in In game at this time",
      maxSteps: 30,
    });
    const evaluator = new Evaluator(stagehand);
    const { evaluation, reasoning } = await evaluator.evaluate({
      question: "Did the agent make it to the steam games page?",
    });
    //strictly used url check and no extract as the top games / players can vary
    const success =
      stagehand.page.url().includes("https://store.steampowered.com/") &&
      evaluation === "YES";

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
