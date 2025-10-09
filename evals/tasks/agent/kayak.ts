import { EvalFunction } from "@/lib/v3/types/public/evals";
import { V3Evaluator } from "@/evals/v3Evaluator";

export const kayak: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  logger,
  v3Agent,
  v3,
}) => {
  try {
    const evaluator = new V3Evaluator(v3);
    const page = v3.context.pages()[0];
    await page.goto("https://www.kayak.com");

    await v3Agent.execute({
      instruction: "Find flights from San Francisco to Tokyo next week",
      maxSteps: Number(process.env.AGENT_EVAL_MAX_STEPS) || 25,
    });
    await v3Agent.execute({
      instruction: "Sort the flights by price",
      maxSteps: Number(process.env.AGENT_EVAL_MAX_STEPS) || 8,
    });

    if (v3.context.pages().length !== 2) {
      return {
        _success: false,
        message: "No new pages were opened",
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }
    const { evaluation, reasoning } = await evaluator.ask({
      question:
        "Are the flights shown sorted by price? Check the sort button in the top left corner of the page. It should show cheapest first; use this as the success criteria since the page might promote other flights and not show the list in order.",
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
      message: error.message,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } finally {
    await v3.close();
  }
};
