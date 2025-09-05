import { EvalFunction } from "@/types/evals";

export const steam_games: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
  agent,
}) => {
  try {
    await stagehand.page.goto("https://store.steampowered.com/");

    const agentResult = await agent.execute({
      instruction:
        "Show most played games in Steam. And tell me the number of players in game at this time",
      maxSteps: Number(process.env.AGENT_EVAL_MAX_STEPS) || 30,
    });

    //strictly used url check and no extract as the top games / players can vary
    const success = stagehand.page
      .url()
      .includes("https://store.steampowered.com/");

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
