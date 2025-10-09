import { EvalFunction } from "@/lib/v3/types/public/evals";
import { V3Evaluator } from "../../v3Evaluator";
import { ScreenshotCollector } from "../../utils/ScreenshotCollector";
import dotenv from "dotenv";
import fs from "fs";
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
      model: modelName,
      provider: modelName.startsWith("claude") ? "anthropic" : "openai",
      instructions: `You are a helpful assistant that must solve the task by browsing. At the end, produce a single line: "Final Answer: <answer>" summarizing the requested result (e.g., score, list, or text). Current page: ${await page.title()}. ALWAYS OPERATE WITHIN THE PAGE OPENED BY THE USER, WHICHEVER TASK YOU ARE ATTEMPTING TO COMPLETE CAN BE ACCOMPLISHED WITHIN THE PAGE.`,
    });

    const screenshot = await page.screenshot();
    fs.writeFileSync("screenshot.png", screenshot);

    // Start collecting screenshots in parallel
    const screenshotCollector = new ScreenshotCollector(page, {
      maxScreenshots: 5, // Keep up to the last 5 screenshots
      captureOnNavigation: true, // Also capture on page navigation
    });

    screenshotCollector.start();

    const agentResult = await agent.execute({
      instruction: params.confirmed_task,
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
