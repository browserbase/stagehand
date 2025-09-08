//this eval is expected to fail.
import { EvalFunction } from "@/types/evals";
import { Evaluator } from "@/evals/evaluator";
import { ScreenshotCollector } from "@/evals/utils/ScreenshotCollector";
export const hotel_booking: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
  agent,
}) => {
  try {
    await stagehand.page.goto("https://www.booking.com/");

    const screenshotCollector = new ScreenshotCollector(stagehand.page, {
      maxScreenshots: 10, // Keep last 10 screenshots
      captureOnNavigation: true, // Also capture on page navigation
    });

    screenshotCollector.start();

    const agentResult = await agent.execute({
      instruction:
        "Find a hotel in Sydney with a rating of 8 or higher, providing free Wi-Fi and parking, available for a four-night stay starting on December 10, 2025.",
      maxSteps: Number(process.env.AGENT_EVAL_MAX_STEPS) || 20,
    });
    logger.log(agentResult);

    const screenshots = screenshotCollector.stop();

    const evaluator = new Evaluator(stagehand);
    const { evaluation, reasoning } = await evaluator.ask({
      question:
        "Does the page show or agent mention a hotel in Sydney with a rating of 8 or higher, providing free Wi-Fi and parking, available for a four-night stay starting on December 10, 2025?",
      agentReasoning: agentResult.message,
      screenshot: screenshots,
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
    await stagehand.close();
  }
};
