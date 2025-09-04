import { EvalFunction } from "@/types/evals";
import { z } from "zod";

export const apple_tv: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
  agent,
}) => {
  try {
    await stagehand.page.goto("https://www.apple.com/");

    const agentResult = await agent.execute({
      instruction:
        "Identify the size and weight for the Apple TV 4K and list the Siri Remote features introduced.",
      maxSteps: Number(process.env.AGENT_EVAL_MAX_STEPS) || 30,
    });

    const { height, width } = await stagehand.page.extract({
      modelName: "google/gemini-2.5-flash",
      instruction: "Extract the size and weight of the Apple TV 4K",
      schema: z.object({
        height: z.number().describe("The height of the Apple TV 4K in inches"),
        width: z.number().describe("The width of the Apple TV 4K in inches"),
      }),
    });

    const success =
      agentResult.success &&
      height === 1.2 &&
      width === 3.66 &&
      stagehand.page.url().includes("https://www.apple.com/apple-tv-4k/specs/");

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
