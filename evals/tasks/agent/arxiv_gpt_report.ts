//agent often fails on this one,
import { EvalFunction } from "@/types/evals";
import { Evaluator } from "../../evaluator";
export const arxiv_gpt_report: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
  agent,
}) => {
  try {
    const evaluator = new Evaluator(stagehand);
    await stagehand.page.goto("https://arxiv.org/");

    await agent.execute({
      instruction:
        "Find the paper 'GPT-4 Technical Report', when was v3 submitted?",
      maxSteps: Number(process.env.AGENT_EVAL_MAX_STEPS) || 25,
    });

    // Mon, 27 Mar 2023 17:46:54 UTC

    const { evaluation, reasoning } = await evaluator.ask({
      question:
        "Did the agent find the published paper 'GPT-4 Technical Report' and the date it was submitted?",
      screenshot: false,
      answer: "03-27-2023",
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
    return {
      _success: false,
      message: error.message,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } finally {
    await stagehand.close();
  }
};
