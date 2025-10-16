import { EvalFunction } from "@/types/evals";
import { Evaluator } from "@/evals/evaluator";
export const google_maps_3: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
  agent,
}) => {
  try {
    await stagehand.page.goto("https://maps.google.com/");
    const evaluator = new Evaluator(stagehand);
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
        observations: reasoning,
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
      error: error,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } finally {
    await stagehand.close();
  }
};
