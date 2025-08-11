import { EvalFunction } from "@/types/evals";

export const arxiv_gpt_report: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
  modelName,
}) => {
  try {
    await stagehand.page.goto("https://arxiv.org/");
    const agent = stagehand.agent({
      model: modelName,
      provider: modelName.startsWith("claude") ? "anthropic" : "openai",
      instructions: `You are a helpful web automation assistant. DON'T ASK FOLLOW UP QUESTIONS UNTIL YOU HAVE FULFILLED THE USER'S REQUEST. Today is ${new Date().toLocaleDateString()}.`,
    });

    const agentResult = await agent.execute({
      instruction:
        "Find the paper 'GPT-4 Technical Report', when was v3 submitted?",
      maxSteps: 30,
    });

    const success = agentResult.success;

    if (!success) {
      return {
        _success: false,
        message: agentResult.message,
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
