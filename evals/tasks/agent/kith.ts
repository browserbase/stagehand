import { EvalFunction } from "@/types/evals";
import { Evaluator } from "@/evals/evaluator";

export const kith: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
  agent,
}) => {
  try {
    const evaluator = new Evaluator(stagehand);
    await stagehand.page.goto(
      "https://kith.com/collections/nike-air-force-1/products/nkcw2288-111?variant=19439468707968",
    );

    await agent.execute({
      instruction:
        "add the shoes to cart, go to checkout, and fill the delivery information. Don't fill the payment information",
      maxSteps: Number(process.env.AGENT_EVAL_MAX_STEPS) || 25,
    });

    const { evaluation, reasoning } = await evaluator.ask({
      question: "Did the agent fill the delivery information",
    });

    const success = evaluation === "YES";

    if (success) {
      await agent.execute({
        instruction:
          "fill the credit card information, do not submit the order just add placeholders",
        maxSteps: Number(process.env.AGENT_EVAL_MAX_STEPS) || 10,
      });

      const { evaluation: evaluation2, reasoning: reasoning2 } =
        await evaluator.ask({
          question: "Did the agent fill the payment information",
        });

      const success2 = evaluation2 === "YES";

      if (success2) {
        return {
          _success: true,
          debugUrl,
          sessionUrl,
          logs: logger.getLogs(),
        };
      } else {
        return {
          _success: false,
          message: reasoning2,
          debugUrl,
          sessionUrl,
          logs: logger.getLogs(),
        };
      }
    } else {
      return {
        _success: false,
        message: reasoning,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }
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
