import { EvalFunction } from "@/types/evals";
import { Evaluator } from "../../evaluator";
import { ScreenshotCollector } from "../../utils/ScreenshotCollector";
import * as path from "path";
import * as fs from "fs";

interface ReferenceAnswer {
  id: number;
  type: "golden" | "possible";
  ans: string;
}

interface WebsiteAnswers {
  notice?: string;
  answers: ReferenceAnswer[];
}

interface ReferenceData {
  [website: string]: WebsiteAnswers;
}

// Helper function to load reference answers
function getReferenceAnswers(
  website: string | undefined,
  idStr: string,
): ReferenceAnswer[] {
  if (!website || !idStr) return [];

  try {
    const id = parseInt(idStr.split("--").pop() || "");
    if (isNaN(id)) return [];

    const websiteName = idStr.split("--")[0];
    const referencePath = path.join(
      __dirname,
      "../../datasets/webvoyager/reference-answers.json",
    );
    const rawData = fs.readFileSync(referencePath, "utf-8");
    const referenceData = JSON.parse(rawData) as ReferenceData;

    const websiteData = referenceData[websiteName];
    if (!websiteData || !websiteData.answers) return [];

    const answer = websiteData.answers.find(
      (ans: ReferenceAnswer) => ans.id === id,
    );
    return answer ? [answer] : [];
  } catch (error) {
    console.warn(`Failed to load reference answers:`, error);
    return [];
  }
}

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

    const evaluator = new Evaluator(stagehand);

    // Try ground truth evaluation first if enabled and we have an answer
    if (useGroundTruth && agentAnswer && params.id) {
      logger.log({
        category: "evaluation",
        message: `Checking ground truth for task ${params.id} with agent answer: "${agentAnswer}"`,
        level: 1,
      });

      // Load reference answers
      const referenceAnswers = getReferenceAnswers(
        params.web_name || params.web,
        params.id,
      );

      if (referenceAnswers.length > 0) {
        const groundTruthPrompt = `You are evaluating if an agent's answer matches reference answers for a web task.

Guidelines:
- GOLDEN answers are the most ideal/correct responses - prioritize matching these
- POSSIBLE answers are acceptable alternative responses
- Look for semantic equivalence, not exact word matching
- Consider if the agent's answer contains the key information from any reference answer
- Be reasonably flexible with formatting and phrasing differences
- Return YES if the answer matches any reference answer semantically
- Return NO only if the answer clearly doesn't match any reference answer

Reference Answers:
${referenceAnswers.map((ref: ReferenceAnswer) => `- ${ref.type.toUpperCase()}: "${ref.ans}"`).join("\n")}

Today's date is ${new Date().toLocaleDateString()}`;

        const groundTruthResult = await evaluator.ask({
          question: `Did the agent provide a correct answer for the task: "${params.ques}"?`,
          answer: agentAnswer,
          screenshot: false,
          agentReasoning: agentResult.message,
          systemPrompt: groundTruthPrompt,
        });

        logger.log({
          category: "evaluation",
          message: `Ground truth result: ${groundTruthResult.evaluation}, reasoning: ${groundTruthResult.reasoning}`,
          level: 1,
        });

        // If we got a clear YES/NO from ground truth, use it
        if (groundTruthResult.evaluation !== "INVALID") {
          return {
            _success: groundTruthResult.evaluation === "YES",
            reasoning: `Ground truth evaluation: ${groundTruthResult.reasoning}`,
            groundTruthUsed: true,
            agentAnswer,
            screenshotCount: screenshots.length,
            debugUrl,
            sessionUrl,
            logs: logger.getLogs(),
          };
        }

        logger.log({
          category: "evaluation",
          message:
            "Ground truth evaluation invalid, falling back to screenshot evaluation",
          level: 1,
        });
      }
    }

    // Use screenshot evaluation (default or fallback)
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
