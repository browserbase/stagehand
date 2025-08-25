import { EvalFunction } from "@/types/evals";
import { z } from "zod";

export const hugging_face: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
  agent,
}) => {
  try {
    await stagehand.page.goto("https://huggingface.co/");
    const agentResult = await agent.execute({
      instruction:
        "Search for a model on Hugging Face with an Apache-2.0 license that has received the highest number of likes.",
      maxSteps: 15,
    });

    const { modelName } = await stagehand.page.extract({
      modelName: "google/gemini-2.5-flash",
      instruction: "Extract the name of the model",
      schema: z.object({
        modelName: z.string(),
      }),
    });
    console.log(`modelName: ${modelName}`);
    const success = agentResult.success && modelName === "Kokoro-82M";
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
