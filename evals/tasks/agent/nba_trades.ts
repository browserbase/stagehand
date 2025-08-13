import { EvalFunction } from "@/types/evals";

export const nba_trades: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
  agent,
}) => {
  try {
    await stagehand.page.goto("https://www.espn.com/");

    const agentResult = await agent.execute({
      instruction:
        "Find the latest Team transactions in the NBA within the past week.",
      maxSteps: 30,
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
