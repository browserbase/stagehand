import { EvalFunction } from "../../types/evals";
import { V3Evaluator } from "@browserbasehq/stagehand";
import { ScreenshotCollector } from "../../utils/ScreenshotCollector";

export const webvoyager: EvalFunction = async ({
  v3,
  logger,
  debugUrl,
  sessionUrl,
  modelName,
  input,
}) => {
  try {
    const params = ((input && input.params) || {}) as {
      id?: string;
      web?: string;
      ques?: string;
      web_name?: string;
    };

    if (!params.web || !params.ques) {
      return {
        _success: false,
        error: `Missing WebVoyager params (web, ques). Got: ${JSON.stringify(params)}`,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }

    const page = v3.context.pages()[0];
    await page.goto(params.web);

    const agent = v3.agent({
      model: modelName,
      systemPrompt: `You are a helpful assistant that must solve the task by browsing. At the end, produce a single line: "Final Answer: <answer>" summarizing the requested result (e.g., score, list, or text). Current page: ${await page.title()}`,
    });

    // Start collecting screenshots in parallel
    const screenshotCollector = new ScreenshotCollector(page, {
      maxScreenshots: 10, // Keep last 10 screenshots
      captureOnNavigation: true, // Also capture on page navigation
    });

    screenshotCollector.start();

    const agentResult = await agent.execute({
      instruction: params.ques,
      maxSteps: Number(process.env.AGENT_EVAL_MAX_STEPS) || 50,
    });

    // Stop collecting and get all screenshots
    const screenshots = screenshotCollector.stop();

    logger.log({
      category: "evaluation",
      message: `Collected ${screenshots.length} screenshots for evaluation`,
      level: 1,
    });

    const evaluator = new V3Evaluator(v3);
    const evalResult = await evaluator.ask({
      question: `Did the agent successfully complete this task: "${params.ques}"?`,
      screenshot: screenshots,
      agentReasoning:
        agentResult.message ||
        "no reasoning available, agent potentially hit step limit",
    });

    return {
      _success: evalResult.evaluation === "YES",
      reasoning: evalResult.reasoning,
      screenshotCount: screenshots.length,
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
  }
};
