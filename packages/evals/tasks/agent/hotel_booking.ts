//this eval is expected to fail.
import { EvalFunction } from "../../types/evals";
import { V3Evaluator } from "@browserbasehq/stagehand";

export const hotel_booking: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  logger,
  agent,
  v3,
}) => {
  try {
    const page = v3.context.pages()[0];
    await page.goto("https://www.booking.com/");

    const agentResult = await agent.execute({
      instruction:
        "Find a hotel in Sydney with a rating of 8 or higher, providing free Wi-Fi and parking, available for a four-night stay starting on December 10, 2025.",
      maxSteps: Number(process.env.AGENT_EVAL_MAX_STEPS) || 20,
    });
    logger.log(agentResult);

    const evaluator = new V3Evaluator(v3);
    const { evaluation, reasoning } = await evaluator.ask({
      question:
        "Does the page show a hotel in Sydney with a rating of 8 or higher, providing free Wi-Fi and parking, available for a four-night stay starting on December 10, 2025?",
    });

    const success = evaluation === "YES";

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
    await v3.close();
  }
};
