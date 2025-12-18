import { EvalFunction } from "../../types/evals";
import { V3Evaluator } from "@browserbasehq/stagehand";
import { ScreenshotCollector } from "../../utils/ScreenshotCollector";

export const iframe_form: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  logger,
  agent,
  v3,
}) => {
  try {
    const page = v3.context.pages()[0];
    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/iframe-form-filling/",
    );

    const screenshotCollector = new ScreenshotCollector(v3, {
      maxScreenshots: 15,
    });
    screenshotCollector.start();

    const instruction =
      "Fill in the form name with 'John Smith' and fill in the form email with 'john.smith@example.com'";
    const agentResult = await agent.execute({
      instruction,
      maxSteps: Number(process.env.AGENT_EVAL_MAX_STEPS) || 10,
    });

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
