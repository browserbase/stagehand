import { EvalFunction } from "../../types/evals";
import { V3Evaluator } from "@browserbasehq/stagehand";

export const ubereats: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  logger,
  agent,
  v3,
}) => {
  try {
    const evaluator = new V3Evaluator(v3);
    const page = v3.context.pages()[0];
    await page.goto("https://www.ubereats.com/");

    await agent.execute({
      instruction:
        "Order a pizza from ubereats to 639 geary st in sf, call the task complete once the login page is shown after adding pizza and viewing the cart",
      maxSteps: Number(process.env.AGENT_EVAL_MAX_STEPS) || 35,
    });

    const { evaluation, reasoning } = await evaluator.ask({
      question: "Did the agent make it to the login page?",
    });

    const success =
      evaluation === "YES" && page.url().includes("https://auth.uber.com/");
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
