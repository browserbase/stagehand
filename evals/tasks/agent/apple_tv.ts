import { EvalFunction } from "@/types/evals";

import { Evaluator } from "../../evaluator";
export const apple_tv: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
  agent,
}) => {
  try {
    await stagehand.page.goto("https://www.apple.com/");

    const agentResult = await agent.execute({
      instruction:
        "Identify the size and weight for the Apple TV 4K and list the Siri Remote features introduced.",
      maxSteps: Number(process.env.AGENT_EVAL_MAX_STEPS) || 50,
    });

    const evaluator = new Evaluator(stagehand);
    const result = await evaluator.ask({
      question:
        "did the agent find the height and width of the Apple TV 4K in its reasoning which is 1.2 and 3.66?",
      answer: agentResult.message,
    });

    const success = result.evaluation === "YES";
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
      message: error.message,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } finally {
    await stagehand.close();
  }
};
