import { EvalFunction } from "../../types/evals";
import { V3Evaluator } from "@browserbasehq/stagehand";

export const google_maps_3: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  logger,
  agent,
  v3,
}) => {
  try {
    const page = v3.context.pages()[0];
    await page.goto("https://maps.google.com/");
    const evaluator = new V3Evaluator(v3);
    await agent.execute({
      instruction:
        "Search for locksmiths open now but not open 24 hours in Texas City.",
      maxSteps: Number(process.env.AGENT_EVAL_MAX_STEPS) || 35,
    });

    const { evaluation, reasoning } = await evaluator.ask({
      question:
        "Does the page show a locksmiths open now but not open 24 hours in Texas City?",
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
      message: error.message,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } finally {
    await v3.close();
  }
};
