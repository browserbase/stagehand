import { EvalFunction } from "@/types/evals";
import { Evaluator } from "@/evals/evaluator";
export const github_react_version: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
  agent,
}) => {
  try {
    const evaluator = new Evaluator(stagehand);
    await stagehand.page.goto("https://github.com/");
    await agent.execute({
      instruction:
        "Check the latest release version of React and the date it was published. ",
      maxSteps: Number(process.env.AGENT_EVAL_MAX_STEPS) || 20,
    });
    const { evaluation, reasoning } = await evaluator.ask({
      question:
        "Does the page show the latest version of react and the date it was published",
    });
    console.log(`evaluation: ${evaluation}`);
    console.log(`reasoning: ${reasoning}`);
    // only use url check for now, as using extract on the version is prone to breaking in future
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
    await stagehand.close();
  }
};
