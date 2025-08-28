import { EvalFunction } from "@/types/evals";
import { Evaluator } from "../../evaluator";

export const webvoyager: EvalFunction = async ({
  stagehand,
  logger,
  debugUrl,
  sessionUrl,
  modelName,
  input,
}) => {
  try {
    const params = ((input && input.params) || {}) as {
      id?: string;
      web?: string;
      ques?: string;
      web_name?: string;
    };

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

    const agent = stagehand.agent({
      model: modelName,
      provider: modelName.startsWith("claude") ? "anthropic" : "openai",
      instructions: `You are a helpful assistant that must solve the task by browsing. At the end, produce a single line: "Final Answer: <answer>" summarizing the requested result (e.g., score, list, or text). Current page: ${await stagehand.page.title()}`,
    });

    await agent.execute({
      instruction: params.ques,
      maxSteps: 50,
    });

    const evaluator = new Evaluator(stagehand);
    const evalResult = await evaluator.ask({
      question: `Did the agent successfully complete this task: "${params.ques}"? Look at the current state of the page to verify if the task was completed successfully.`,
      screenshot: true,
    });

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
  }
};
