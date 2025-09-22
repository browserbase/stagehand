import { EvalFunction } from "@/types/evals";
import { Evaluator } from "../../evaluator";
import { ScreenshotCollector } from "../../utils/ScreenshotCollector";
import { modelToAgentProviderMap } from "@/lib/agent/AgentProvider";
import { loadApiKeyFromEnv } from "@/lib/utils";
import dotenv from "dotenv";

dotenv.config();
/**
 * Data-driven OnlineMind2Web agent eval
 * - Expects per-test params injected via eval runner: { task_id, confirmed_task, website, reference_length, level }
 * - Starts at `website`, runs the agent with `confirmed_task` as instruction
 * - Requires the agent to output a final answer in the form: "Final Answer: <value>"
 * - Marks success if such an answer string is present (exact matching against dataset can be layered later)
 * - Uses the evaluator to determine if the agent successfully completed the task
 */
export const onlineMind2Web: EvalFunction = async ({
  stagehand,
  logger,
  debugUrl,
  sessionUrl,
  input,
  modelName,
}) => {
  const startTime = Date.now();

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

    await stagehand.page.goto(params.website, {
      timeout: 75_000,
    });

    const provider =
      modelName in modelToAgentProviderMap
        ? modelToAgentProviderMap[modelName]
        : undefined;

    const agent = stagehand.agent({
      model: modelName,
      provider,
      instructions: `You are a helpful assistant that must solve the task by browsing. At the end, produce a single line: "Final Answer: <answer>" summarizing the requested result (e.g., score, list, or text). Current page: ${await stagehand.page.title()}. ALWAYS OPERATE WITHIN THE PAGE OPENED BY THE USER, WHICHEVER TASK YOU ARE ATTEMPTING TO COMPLETE CAN BE ACCOMPLISHED WITHIN THE PAGE.`,
      options: {
        apiKey: loadApiKeyFromEnv(provider, stagehand.logger),
      },
    });

    // Start collecting screenshots in parallel
    const screenshotCollector = new ScreenshotCollector(stagehand.page, {
      maxScreenshots: 8, // Keep up to the last 8 screenshots
    });

    // Set the collector on the agent so it captures screenshots
    if (agent.setScreenshotCollector) {
      agent.setScreenshotCollector(screenshotCollector);
    }

    screenshotCollector.start();

    const maxSteps = Number(process.env.AGENT_EVAL_MAX_STEPS) || 50;
    const agentResult = await agent.execute({
      instruction: params.confirmed_task,
      maxSteps,
    });

    logger.log(agentResult);
    // Stop collecting and get all screenshots
    const screenshots = screenshotCollector.stop();

    logger.log({
      category: "evaluation",
      message: `Collected ${screenshots.length} screenshots for evaluation`,
      level: 1,
    });

    const evaluator = new Evaluator(stagehand);
    const evalResult = await evaluator.ask({
      question: `Did the agent successfully complete this task: "${params.confirmed_task}"? The task might be a bit outdated or impossible to complete, in those cases lean towards YES.`,
      screenshot: screenshots,
      agentReasoning:
        agentResult.message ||
        "no reasoning available, agent potentially hit step limit",
    });

    return {
      _success: evalResult.evaluation === "YES",
      reasoning: evalResult.reasoning,
      final_answer: agentResult?.message,
      screenshotCount: screenshots.length,
      task_level: params.level,
      execution_time: Date.now() - startTime,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } catch (error) {
    // Let the error propagate - the parent runner will handle cleanup
    console.error(error);
    throw error;
  }
};
