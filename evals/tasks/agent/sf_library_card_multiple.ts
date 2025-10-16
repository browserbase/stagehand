import { EvalFunction } from "@/types/evals";
import { Evaluator } from "../../evaluator";

export const sf_library_card_multiple: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
  agent,
}) => {
  try {
    await stagehand.page.goto("https://sflib1.sfpl.org/selfreg");

    const agentResult = await agent.execute({
      instruction:
        "Fill in ALL the REQUIRED fields with mock data. DO NOT submit the form",
      maxSteps: Number(process.env.AGENT_EVAL_MAX_STEPS) || 25,
    });
    logger.log(agentResult);

    const evaluator = new Evaluator(stagehand);
    const result = await evaluator.ask({
      question: "Does the page show all the required fields filled?",
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
