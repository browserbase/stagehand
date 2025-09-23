import { EvalFunction } from "@/types/evals";
import { Evaluator } from "../../evaluator";
import { ScreenshotCollector } from "../../utils/ScreenshotCollector";
import { loadApiKeyFromEnv } from "@/lib/utils";
import { modelToAgentProviderMap } from "@/lib/agent/AgentProvider";
import dotenv from "dotenv";

dotenv.config();
/**
 * Data-driven GAIA agent eval
 * - Expects per-test params injected via eval runner: { id, level, web, ques }
 * - Starts at `web`, runs the agent with `ques` as instruction
 * - Requires the agent to output a final answer in the form: "Final Answer: <value>"
 * - Marks success if such an answer string is present (exact matching against dataset can be layered later)
 */
export const gaia: EvalFunction = async ({
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
      id?: string;
      level?: number;
      web?: string;
      ques?: string;
      expected?: string;
    };

    if (!params.web || !params.ques) {
      return {
        _success: false,
        error: `Missing GAIA params (web, ques). Got: ${JSON.stringify(params)}`,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }

    await stagehand.page.goto(params.web, {
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

    // Start collecting screenshots with hybrid approach
    const screenshotCollector = new ScreenshotCollector(stagehand.page, {
      maxScreenshots: 8, // Keep last 8 screenshots
    });

    // Set the collector on the agent so it captures screenshots
    if (agent.setScreenshotCollector) {
      agent.setScreenshotCollector(screenshotCollector);
    }

    screenshotCollector.start();

    const maxSteps = Number(process.env.AGENT_EVAL_MAX_STEPS) || 50;
    const agentResult = await agent.execute({
      instruction: params.ques,
      maxSteps,
    });
    // Stop collecting and get all screenshots
    const screenshots = screenshotCollector.stop();

    logger.log({
      category: "evaluation",
      message: `Collected ${screenshots.length} screenshots for evaluation`,
      level: 1,
    });

    const expected = params.expected;
    const evaluator = new Evaluator(stagehand);
    const evalResult = await evaluator.ask({
      question: `Did the agent provide the expected answer: "${expected}"?`,
      answer: agentResult.message || "",
      screenshot: screenshots,
    });

    return {
      _success: evalResult.evaluation === "YES",
      reasoning: evalResult.reasoning,
      expectedAnswer: expected,
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
