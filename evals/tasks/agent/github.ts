import { EvalFunction } from "@/lib/v3/types/public/evals";
import { V3Evaluator } from "@/evals/v3Evaluator";
export const github: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  logger,
  v3Agent,
  v3,
}) => {
  try {
    const page = v3.context.pages()[0];
    await page.goto("https://github.com/");
    const evaluator = new V3Evaluator(v3);
    const agentResult = await v3Agent.execute({
      instruction:
        "Find a Ruby repository on GitHub that has been updated in the past 3 days and has at least 1000 stars.",
      maxSteps: Number(process.env.AGENT_EVAL_MAX_STEPS) || 20,
    });
    logger.log(agentResult);

    const { evaluation, reasoning } = await evaluator.ask({
      question:
        "Ruby repository on GitHub that has been updated in the past 3 days and has at least 1000 stars.",
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
