import { EvalFunction } from "../../types/evals";
import { V3Evaluator } from "@browserbasehq/stagehand";
import { ScreenshotCollector } from "../../utils/ScreenshotCollector";

/**
 * Data-driven GAIA agent eval
 * - Expects per-test params injected via eval runner: { id, level, web, ques }
 * - Starts at `web`, runs the agent with `ques` as instruction
 * - Requires the agent to output a final answer in the form: "Final Answer: <value>"
 * - Marks success if such an answer string is present (exact matching against dataset can be layered later)
 */
export const gaia: EvalFunction = async ({
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
      level?: number;
      web?: string;
      ques?: string;
    };

    if (!params.web || !params.ques) {
      logger.error({
        category: "gaia",
        level: 0,
        message: `Missing GAIA params (web, ques).`,
        auxiliary: {
          params: { value: JSON.stringify(params), type: "object" },
        },
      });
      return {
        _success: false,
        error: `Missing GAIA params (web, ques). Got: ${JSON.stringify(params)}`,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }
    const page = v3.context.pages()[0];
    await page.goto(params.web);

    const screenshotCollector = new ScreenshotCollector(v3, {
      maxScreenshots: 15,
    });
    screenshotCollector.start();

    const agent = v3.agent({
      model: modelName,
      systemPrompt: `You are a helpful assistant that must solve the task by browsing. You must produce a single line at the end like: "Final Answer: <answer>". Do not ask follow up questions. Current page: ${await page.title()}`,
    });

    const instruction = params.ques;
    const agentResult = await agent.execute({
      instruction,
      maxSteps: Number(process.env.AGENT_EVAL_MAX_STEPS) || 50,
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
    logger.error({
      category: "gaia",
      level: 0,
      message: `Unhandled error in GAIA task`,
      auxiliary: {
        error: {
          value: error instanceof Error ? error.message : String(error),
          type: "string",
        },
        trace: {
          value: error instanceof Error && error.stack ? error.stack : "",
          type: "string",
        },
      },
    });
    return {
      _success: false,
      error,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  }
};
