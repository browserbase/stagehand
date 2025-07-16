import { EvalFunction } from "@/types/evals";
import { Evaluator } from "@/evals/evaluator";

export const kayak: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
}) => {
  try {
    const evaluator = new Evaluator(stagehand);
    await stagehand.page.goto("https://www.kayak.com");
    const agent = stagehand.agent({
      provider: "openai",
      model: "computer-use-preview",
      instructions: `You are a helpful assistant that can help me find flights. DON'T ASK FOLLOW UP QUESTIONS UNTIL YOU HAVE FULFILLED THE USER'S REQUEST. Today is ${new Date().toLocaleDateString()}.`,
      options: {
        apiKey: process.env.OPENAI_API_KEY,
      },
    });
    await agent.execute({
      instruction: "Find flights from San Francisco to Tokyo next week",
      maxSteps: 15,
    });
    await agent.execute({
      instruction: "Sort the flights by price",
      maxSteps: 5,
    });

    if (stagehand.context.pages().length !== 2) {
      return {
        _success: false,
        message: "No new pages were opened",
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }
    const { evaluation, reasoning } = await evaluator.evaluate({
      question: "Are the flights shown sorted by price?",
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
    await stagehand.close();
  }
};
