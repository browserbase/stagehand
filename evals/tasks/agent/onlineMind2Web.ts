import { EvalFunction } from "@/types/evals";
import { Evaluator } from "../../evaluator";
import { ScreenshotCollector } from "../../utils/ScreenshotCollector";
import { modelToAgentProviderMap } from "@/lib/agent/AgentProvider";
import { loadApiKeyFromEnv } from "@/lib/utils";
import dotenv from "dotenv";

dotenv.config();

export const onlineMind2Web: EvalFunction = async ({
  stagehand,
  logger,
  debugUrl,
  sessionUrl,
  modelName,
  input,
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
      timeout: 120_000,
    });

    if (!(modelName in modelToAgentProviderMap)) {
      return {
        _success: false,
        error: `Model ${modelName} is not supported for agent tasks. Supported models: ${Object.keys(modelToAgentProviderMap).join(", ")}`,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }

    const provider = modelToAgentProviderMap[modelName];
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

    const maxSteps = Number(process.env.AGENT_EVAL_MAX_STEPS) || 80;
    const agentResult = await agent.execute({
      instruction: params.confirmed_task,
      maxSteps: maxSteps,
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
      question: `Did the agent successfully complete this task: "${params.confirmed_task}"?`,
      screenshot: screenshots,
      agentReasoning:
        agentResult.message ||
        "no reasoning available, agent potentially hit step limit",
    });

    if (
      evalResult.reasoning.includes("access denied") &&
      evalResult.evaluation === "NO"
    ) {
      throw new Error("access denied");
    }

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
