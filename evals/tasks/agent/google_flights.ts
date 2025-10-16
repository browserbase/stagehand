import { EvalFunction } from "@/types/evals";
import { Evaluator } from "../../evaluator";

export const google_flights: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
  agent,
}) => {
  try {
    await stagehand.page.goto("https://google.com/travel/flights");

    const agentResult = await agent.execute({
      instruction:
        "Search for flights from San Francisco to New York for next weekend",
      maxSteps: Number(process.env.AGENT_EVAL_MAX_STEPS) || 40,
    });
    logger.log(agentResult);

    const evaluator = new Evaluator(stagehand);
    const result = await evaluator.ask({
      question:
        "Does the page show flights (options, available flights, not a search form) from San Francisco to New York?",
    });

    if (result.evaluation !== "YES" && result.evaluation !== "NO") {
      return {
        _success: false,
        observations: "Evaluator provided an invalid response",
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }

    if (result.evaluation === "YES") {
      return {
        _success: true,
        observations: result.reasoning,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } else {
      return {
        _success: false,
        observations: result.reasoning,
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
    await stagehand.close();
  }
};
