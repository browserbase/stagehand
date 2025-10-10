import { EvalFunction } from "../../types/evals";

export const youtube: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  logger,
  v3Agent,
  v3,
}) => {
  try {
    const page = v3.context.pages()[0];
    await page.goto("https://youtube.com");

    const agentResult = await v3Agent.execute({
      instruction:
        "Search for Keinemusik's set under some very famous pointy landmarks. Make sure to click on the video",
      maxSteps: Number(process.env.AGENT_EVAL_MAX_STEPS) || 15,
    });
    logger.log(agentResult);
    const url = await page.url();

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
    await v3.close();
  }
};
