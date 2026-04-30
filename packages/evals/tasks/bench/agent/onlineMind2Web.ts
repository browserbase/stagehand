import { defineBenchTask } from "../../../framework/defineTask.js";
import { V3Evaluator } from "@browserbasehq/stagehand";
import { ScreenshotCollector } from "../../../utils/ScreenshotCollector.js";
import { imageResize } from "../../../utils/imageResize.js";

export default defineBenchTask(
  { name: "agent/onlineMind2Web" },
  async ({ v3, logger, debugUrl, sessionUrl, modelName, input }) => {
    let screenshotCollector: ScreenshotCollector | null = null;

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
        timeoutMs: 120_000,
      });

      const systemPrompt = `You are a helpful assistant that must solve the task by browsing. At the end, produce a single line: "Final Answer: <answer>" summarizing the requested result (e.g., score, list, or text). Current page: ${await page.title()}. ALWAYS OPERATE WITHIN THE PAGE OPENED BY THE USER, WHICHEVER TASK YOU ARE ATTEMPTING TO COMPLETE CAN BE ACCOMPLISHED WITHIN THE PAGE.`;
      const agentMode = input.agentMode ?? (input.isCUA ? "cua" : "hybrid");
      const agent =
        agentMode === "cua"
          ? v3.agent({
              mode: "cua",
              model: modelName,
              systemPrompt,
            })
          : v3.agent({
              mode: agentMode,
              model: modelName,
              systemPrompt,
            });

      screenshotCollector = new ScreenshotCollector(v3, {
        interval: 3000,
        maxScreenshots: 7,
      });
      screenshotCollector.start();

      const agentResult = await agent.execute({
        instruction: params.confirmed_task,
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
        question: `Did the agent successfully complete this task: "${params.confirmed_task}"?`,
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
