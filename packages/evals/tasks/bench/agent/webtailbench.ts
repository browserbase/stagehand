import { defineBenchTask } from "../../../framework/defineTask.js";
import { V3Evaluator } from "@browserbasehq/stagehand";
import { ScreenshotCollector } from "../../../utils/ScreenshotCollector.js";
import { imageResize } from "../../../utils/imageResize.js";

export default defineBenchTask(
  { name: "agent/webtailbench" },
  async ({ v3, logger, debugUrl, sessionUrl, modelName, input }) => {
    let screenshotCollector: ScreenshotCollector | null = null;

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

      const systemPrompt = `You are a helpful assistant that must solve the task by browsing. At the end, produce a single line: "Final Answer: <answer>" summarizing the requested result (e.g., score, list, or text). Current page: ${await page.title()}. You will need to navigate to the appropriate website to complete the task.`;
      const agentMode = input.agentMode ?? (input.isCUA ? "cua" : "hybrid");
      const agent = v3.agent({
        mode: agentMode,
        model: modelName,
        systemPrompt,
      });

      screenshotCollector = new ScreenshotCollector(v3, {
        interval: 3000,
        maxScreenshots: 8,
      });
      screenshotCollector.start();

      const agentResult = await agent.execute({
        instruction: params.ques,
        maxSteps: Number(process.env.AGENT_EVAL_MAX_STEPS) || 50,
      });

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
      if (screenshotCollector) {
        try {
          await screenshotCollector.stop();
        } catch {
          // Ignore errors during cleanup
        }
      }
    }
  },
);
