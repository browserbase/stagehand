import { EvalFunction } from "@/types/evals";

export const hugging_face: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
  modelName,
}) => {
  try {
    await stagehand.page.goto("https://huggingface.co/");
    const agent = stagehand.agent({
      model: modelName,
      provider: modelName.startsWith("claude") ? "anthropic" : "openai",
      instructions: `You are a helpful web automation assistant. DON'T ASK FOLLOW UP QUESTIONS UNTIL YOU HAVE FULFILLED THE USER'S REQUEST. Today is ${new Date().toLocaleDateString()}.`,
    });

    const agentResult = await agent.execute({
      instruction:
        "Search for a model on Hugging Face with an Apache-2.0 license that has received the highest number of likes.",
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
