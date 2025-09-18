import { EvalFunction } from "@/types/evals";
import { Evaluator } from "../../evaluator";
import { ScreenshotCollector } from "../../utils/ScreenshotCollector";
import { checkGroundTruthWithLLM } from "../../datasets/webvoyager/groundTruthChecker";

export const webvoyager: EvalFunction = async ({
  stagehand,
  logger,
  debugUrl,
  sessionUrl,
  input,
  agent,
}) => {
  try {
    const params = ((input && input.params) || {}) as {
      id?: string;
      web?: string;
      ques?: string;
      web_name?: string;
    };

    // Ground truth checking is optional and disabled by default
    // WARNING: Ground truth reference values may be outdated and should be used with caution
    const useGroundTruth = process.env.WEBVOYAGER_USE_GROUND_TRUTH === "true";

    if (!params.web || !params.ques) {
      return {
        _success: false,
        error: `Missing WebVoyager params (web, ques). Got: ${JSON.stringify(params)}`,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }

    await stagehand.page.goto(params.web);

    // Start collecting screenshots in parallel
    const screenshotCollector = new ScreenshotCollector(stagehand.page, {
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

    // Extract final answer from agent output
    const finalAnswerMatch = agentResult.message?.match(
      /Final Answer:\s*(.+?)(?:\n|$)/i,
    );
    const agentAnswer = finalAnswerMatch?.[1]?.trim();

    let groundTruthResult = null;
    if (useGroundTruth && agentAnswer && params.id) {
      logger.log({
        category: "evaluation",
        message: `Checking ground truth for task ${params.id} with agent answer: "${agentAnswer}"`,
        level: 1,
      });

      groundTruthResult = await checkGroundTruthWithLLM(
        params.id,
        agentAnswer,
        stagehand,
      );

      logger.log({
        category: "evaluation",
        message: `Ground truth result: ${JSON.stringify(groundTruthResult)}`,
        level: 1,
      });
    }

    // If LLM ground truth comparison is confident, use it
    if (useGroundTruth && groundTruthResult?.confident) {
      return {
        _success: groundTruthResult.match,
        reasoning: `LLM ground truth comparison: ${groundTruthResult.reasoning}`,
        groundTruthUsed: true,
        matchedAnswerType: groundTruthResult.matchedAnswerType,
        agentAnswer,
        screenshotCount: screenshots.length,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }

    // Use VLM screenshot evaluation (default or when ground truth is disabled/inconclusive)
    if (useGroundTruth && !groundTruthResult?.confident) {
      logger.log({
        category: "evaluation",
        message:
          "Ground truth inconclusive, falling back to VLM screenshot evaluation",
        level: 1,
      });
    }

    const evaluator = new Evaluator(stagehand);
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
      groundTruthUsed: false,
      agentAnswer,
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
