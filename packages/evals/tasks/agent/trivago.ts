import { EvalFunction } from "../../types/evals";

export const trivago: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  logger,
  agent,
  v3,
}) => {
  try {
    const page = v3.context.pages()[0];
    await page.goto("https://www.trivago.com/");

    const agentResult = await agent.execute({
      instruction:
        "Find the cheapest room in the hotel H10 Tribeca in Madrid next weekend. Stop at the trivago page showing the results",
      maxSteps: Number(process.env.AGENT_EVAL_MAX_STEPS) || 13,
    });
    logger.log(agentResult);

    const url = page.url();

    if (
      url.includes("hotel-h10-tribeca-madrid") &&
      url.includes("trivago.com")
    ) {
      return {
        _success: true,
        observations: url,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } else {
      return {
        _success: false,
        observations: url,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }
  } catch (error) {
    return {
      _success: false,
      error: error,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } finally {
    await v3.close();
  }
};
