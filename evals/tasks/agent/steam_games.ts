import { EvalFunction } from "@/types/evals";

export const steam_games: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
}) => {
  try {
    await stagehand.page.goto("https://store.steampowered.com/");
    const agent = stagehand.agent({
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      instructions: `You are a helpful assistant that can help me with my tasks. You are given a task and you need to complete it without asking follow up questions. The current page is ${await stagehand.page.title()}`,
      options: {
        apiKey: process.env.ANTHROPIC_API_KEY,
      },
    });

    const agentResult = await agent.execute({
      instruction:
        "Show most played games in Steam. And tell me the number of players in In game at this time",
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
