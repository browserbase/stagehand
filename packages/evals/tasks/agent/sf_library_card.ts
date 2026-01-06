import { EvalFunction } from "../../types/evals";
import { V3Evaluator } from "@browserbasehq/stagehand";

export const sf_library_card: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  logger,
  agent,
  v3,
}) => {
  try {
    const page = v3.context.pages()[0];
    await page.goto("https://sflib1.sfpl.org/selfreg");
    const agentResult = await agent.execute({
      instruction: "Fill in the 'street Address' field with '166 Geary St'",
      maxSteps: Number(process.env.AGENT_EVAL_MAX_STEPS) || 1,
    });
    logger.log(agentResult);
    const evaluator = new V3Evaluator(v3);
    const result = await evaluator.ask({
      question:
        "Does the page show the 'street Address' field filled with '166 Geary St'?",
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
    await v3.close();
  }
};
