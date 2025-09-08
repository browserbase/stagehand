import { EvalFunction } from "@/types/evals";
import { Evaluator } from "@/evals/evaluator";
import { ScreenshotCollector } from "@/evals/utils/ScreenshotCollector";

export const kayak: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
  agent,
}) => {
  try {
    const evaluator = new Evaluator(stagehand);
    await stagehand.page.goto("https://www.kayak.com");

    const screenshotCollector = new ScreenshotCollector(stagehand.page, {
      maxScreenshots: 10, // Keep last 10 screenshots
      captureOnNavigation: true, // Also capture on page navigation
    });

    screenshotCollector.start();

    await agent.execute({
      instruction: "Find flights from San Francisco to Tokyo next week",
      maxSteps: Number(process.env.AGENT_EVAL_MAX_STEPS) || 25,
    });
    const agentResult = await agent.execute({
      instruction: "Find flights from San Francisco to Tokyo next week",
      maxSteps: Number(process.env.AGENT_EVAL_MAX_STEPS) || 25,
    });
    await agent.execute({
      instruction: "Sort the flights by price",
      maxSteps: Number(process.env.AGENT_EVAL_MAX_STEPS) || 8,
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
    const screenshots = screenshotCollector.stop();
    const { evaluation, reasoning } = await evaluator.ask({
      question:
        "were the flights found sorted by price? Check the sort button in the top left corner of the page. It should show cheapest first; use this as the success criteria since the page might promote other flights and not show the list in order.",
      screenshot: screenshots,
      agentReasoning: agentResult.message,
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
