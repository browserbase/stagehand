import { EvalFunction } from "../../types/evals";
import { V3Evaluator } from "@browserbasehq/stagehand";
import { ScreenshotCollector } from "../../utils/ScreenshotCollector";
import { imageResize } from "../../utils/imageResize";

export const webtailbench: EvalFunction = async ({
  v3,
  logger,
  debugUrl,
  sessionUrl,
  modelName,
  input,
}) => {
  // Track resources that need cleanup
  let screenshotCollector: ScreenshotCollector | null = null;
  let screenshotHandler: ((buffer: Buffer) => void) | null = null;

  try {
    const params = ((input && input.params) || {}) as {
      id?: string;
      category?: string;
      ques?: string;
      web?: string;
    };

    if (!params.ques) {
      return {
        _success: false,
        error: `Missing webtailbench params (ques). Got: ${JSON.stringify(params)}`,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }

    const page = v3.context.pages()[0];
    // web field is always empty in WebTailBench; start from Google
    const startUrl = params.web || "https://www.google.com";
    await page.goto(startUrl, {
      timeoutMs: 120_000,
    });

    const agent = v3.agent({
      cua: true,
      model: modelName,
      systemPrompt: `You are a helpful assistant that must solve the task by browsing. At the end, produce a single line: "Final Answer: <answer>" summarizing the requested result (e.g., score, list, or text). Current page: ${await page.title()}. You will need to navigate to the appropriate website to complete the task.`,
    });

    // Set up event-driven screenshot collection via the V3 event bus
    screenshotCollector = new ScreenshotCollector(v3, {
      maxScreenshots: 8,
    });

    // Subscribe to screenshot events from the agent
    screenshotHandler = (buffer: Buffer) => {
      screenshotCollector?.addScreenshot(buffer);
    };
    v3.bus.on("agent_screenshot_taken_event", screenshotHandler);

    const agentResult = await agent.execute({
      instruction: params.ques,
      maxSteps: Number(process.env.AGENT_EVAL_MAX_STEPS) || 50,
    });

    // Clean up event listener and stop collecting
    v3.bus.off("agent_screenshot_taken_event", screenshotHandler);
    // Stop collecting and get all screenshots
    let screenshots = await screenshotCollector.stop();

    // Resize screenshots if we have any
    if (screenshots.length > 0) {
      screenshots = await Promise.all(
        screenshots.map(async (screenshot) => {
          return await imageResize(screenshot, 0.7);
        }),
      );
    }

    logger.log({
      category: "evaluation",
      message: `Collected ${screenshots.length} screenshots for evaluation`,
      level: 1,
    });

    const evaluator = new V3Evaluator(v3);
    const evalResult = await evaluator.ask({
      question: `Did the agent successfully complete this task: "${params.ques}"? Note that the agent does not have purchasing/booking capabilities; mark as pass if the agent has successfully performed all necessary steps for the task up to the point of purchasing/booking/entering payment/user information`,
      screenshot: screenshots,
      agentReasoning:
        agentResult.message ||
        "no reasoning available, agent potentially hit step limit",
    });

    // Clear screenshot buffers to free memory
    screenshots.length = 0;

    return {
      _success: evalResult.evaluation === "YES",
      reasoning: evalResult.reasoning,
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
    // Always clean up event listener and stop collector to prevent hanging
    if (screenshotHandler) {
      try {
        v3.bus.off("agent_screenshot_taken_event", screenshotHandler);
      } catch {
        // Ignore errors during cleanup
      }
    }
    if (screenshotCollector) {
      try {
        await screenshotCollector.stop();
      } catch {
        // Ignore errors during cleanup
      }
    }
  }
};
