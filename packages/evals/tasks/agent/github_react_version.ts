import { EvalFunction } from "../../types/evals";
import { V3Evaluator } from "@browserbasehq/stagehand";
import { ScreenshotCollector } from "../../utils/ScreenshotCollector";

export const github_react_version: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  logger,
  v3,
  agent,
}) => {
  try {
    const page = v3.context.pages()[0];
    await page.goto("https://github.com/");

    const screenshotCollector = new ScreenshotCollector(v3, {
      interval: 3000,
      maxScreenshots: 15,
    });
    screenshotCollector.start();

    const instruction =
      "Check the latest release version of React and the date it was published.";
    const agentResult = await agent.execute({
      instruction,
      maxSteps: Number(process.env.AGENT_EVAL_MAX_STEPS) || 20,
    });

    // Stop and collect all screenshots from the journey
    const screenshots = await screenshotCollector.stop();

    logger.log({
      category: "evaluation",
      message: `Collected ${screenshots.length} screenshots for evaluation`,
      level: 1,
    });

    const evaluator = new V3Evaluator(v3);
    const { evaluation, reasoning } = await evaluator.ask({
      question: `Did the agent complete this task successfully? ${instruction}`,
      screenshot: screenshots,
      agentReasoning: agentResult.message,
    });

    console.log(`reasoning: ${reasoning}`);

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
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      _success: false,
      message: errorMessage,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } finally {
    await v3.close();
  }
};
