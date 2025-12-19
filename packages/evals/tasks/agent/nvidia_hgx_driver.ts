import { EvalFunction } from "../../types/evals";
import { V3Evaluator } from "@browserbasehq/stagehand";
import { ScreenshotCollector } from "../../utils/ScreenshotCollector";

export const nvidia_hgx_driver: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  logger,
  agent,
  v3,
}) => {
  try {
    const page = v3.context.pages()[0];
    await page.goto("https://nvidia.com/");

    // Start collecting screenshots throughout the agent's journey
    const screenshotCollector = new ScreenshotCollector(v3, {
      interval: 3000,
      maxScreenshots: 15,
    });
    screenshotCollector.start();

    const instruction =
      "Find the HGX H100 driver for Ubuntu 22.04 on AMD64 CPU. use https://nvidia.com/ to achieve the task. Don't go to any other site. The task is achievable with just navigation from this site.";
    const agentResult = await agent.execute({
      instruction,
      maxSteps: Number(process.env.AGENT_EVAL_MAX_STEPS) || 40,
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
      question: `did the agent complete this task successfully? ${instruction}`,
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
