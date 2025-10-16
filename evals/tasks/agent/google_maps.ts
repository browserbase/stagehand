import { EvalFunction } from "@/types/evals";
import { Evaluator } from "../../evaluator";

export const google_maps: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
  agent,
}) => {
  const startTime = Date.now();

  try {
    await stagehand.page.goto("https://maps.google.com");

    const maxSteps = Number(process.env.AGENT_EVAL_MAX_STEPS) || 15;
    const agentResult = await agent.execute({
      instruction:
        "How long does it take to get from San Francisco to New York driving?",
      maxSteps: maxSteps,
    });

    logger.log(agentResult);

    const evaluator = new Evaluator(stagehand);
    const result = await evaluator.ask({
      question:
        "Does the page show the time it takes to drive from San Francisco to New York at all?",
    });

    if (result.evaluation !== "YES" && result.evaluation !== "NO") {
      return {
        _success: false,
        observations: "Evaluator provided an invalid response",
        execution_time: Date.now() - startTime,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }

    if (result.evaluation === "YES") {
      return {
        _success: true,
        observations: result.reasoning,
        final_answer: agentResult?.message,
        execution_time: Date.now() - startTime,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } else {
      return {
        _success: false,
        observations: result.reasoning,
        final_answer: agentResult?.message,
        execution_time: Date.now() - startTime,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }
  } finally {
    await stagehand.close();
  }
};
