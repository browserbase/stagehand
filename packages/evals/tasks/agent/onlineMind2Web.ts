import { EvalFunction } from "../../types/evals";
import { V3Evaluator } from "@browserbasehq/stagehand";
import { ScreenshotCollector } from "../../utils/ScreenshotCollector";
import dotenv from "dotenv";
dotenv.config();

export const onlineMind2Web: EvalFunction = async ({
  v3,
  logger,
  debugUrl,
  sessionUrl,
  modelName,
  input,
}) => {
  try {
    const params = ((input && input.params) || {}) as {
      task_id?: string;
      confirmed_task?: string;
      website?: string;
      reference_length?: number;
      level?: string;
    };

    if (!params.website || !params.confirmed_task) {
      return {
        _success: false,
        error: `Missing onlineMind2Web params (website, confirmed_task). Got: ${JSON.stringify(params)}`,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }
    const page = v3.context.pages()[0];
    await page.goto(params.website, {
      timeoutMs: 60_000,
    });

    const agent = v3.agent({
      cua: true,
      model: modelName,
      systemPrompt: `You are a helpful assistant that must solve the task by browsing. At the end, produce a single line: "Final Answer: <answer>" summarizing the requested result (e.g., score, list, or text). Current page: ${await page.title()}. ALWAYS OPERATE WITHIN THE PAGE OPENED BY THE USER, WHICHEVER TASK YOU ARE ATTEMPTING TO COMPLETE CAN BE ACCOMPLISHED WITHIN THE PAGE.`,
    });

    // Set up event-driven screenshot collection via the V3 event bus
    const screenshotCollector = new ScreenshotCollector(v3, {
      maxScreenshots: 5,
    });

    // Subscribe to screenshot events from the agent
    const screenshotHandler = (buffer: Buffer) => {
      screenshotCollector.addScreenshot(buffer);
    };
    v3.bus.on("agent_screenshot_taken_event", screenshotHandler);

    const agentResult = await agent.execute({
      instruction: params.confirmed_task,
      maxSteps: Number(process.env.AGENT_EVAL_MAX_STEPS) || 50,
    });

    // Stop collecting, clean up event listener, and get all screenshots
    v3.bus.off("agent_screenshot_taken_event", screenshotHandler);
    const screenshots = await screenshotCollector.stop();

    logger.log({
      category: "evaluation",
      message: `Collected ${screenshots.length} screenshots for evaluation`,
      level: 1,
    });

    const evaluator = new V3Evaluator(v3);
    const evalResult = await evaluator.ask({
      question: `Did the agent successfully complete this task: "${params.confirmed_task}"?`,
      screenshot: screenshots,
      agentReasoning:
        agentResult.message ||
        "no reasoning available, agent potentially hit step limit",
    });

    return {
      _success: evalResult.evaluation === "YES",
      reasoning: evalResult.reasoning,
      // screenshotCount: screenshots.length,
      task_level: params.level,
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
