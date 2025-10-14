import { EvalFunction } from "../../types/evals";
import { V3Evaluator } from "@browserbasehq/orca";

export const apple_tv: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  logger,
  v3Agent,
  v3,
}) => {
  try {
    const page = v3.context.pages()[0];
    await page.goto("https://www.apple.com/");

    const agentResult = await v3Agent.execute({
      instruction:
        "Identify the size and weight for the Apple TV 4K and list the Siri Remote features introduced.",
      maxSteps: Number(process.env.AGENT_EVAL_MAX_STEPS) || 50,
    });

    const evaluator = new V3Evaluator(v3);
    const result = await evaluator.ask({
      question:
        "did the agent find the height and width of the Apple TV 4K in its reasoning which is 1.2 and 3.66?",
      answer: agentResult.message,
    });

    const url = page.url();
    const success =
      result.evaluation === "YES" &&
      url.includes("https://www.apple.com/apple-tv-4k/specs/");
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
    await v3.close();
  }
};
