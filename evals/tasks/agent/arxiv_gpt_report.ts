//agent often fails on this one,
import { EvalFunction } from "@/types/evals";
import { z } from "zod";
export const arxiv_gpt_report: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
  agent,
}) => {
  try {
    await stagehand.page.goto("https://arxiv.org/");

    const agentResult = await agent.execute({
      instruction:
        "Find the paper 'GPT-4 Technical Report', when was v3 submitted?",
      maxSteps: 20,
    });

    // Mon, 27 Mar 2023 17:46:54 UTC
    const { date } = await stagehand.page.extract({
      modelName: "google/gemini-2.5-flash",
      instruction:
        "Extract the date of the v3 submission history, it should be in the format 'MM-DD-YYYY'",
      schema: z.object({
        date: z.string().describe("The date of the v3 submission history"),
      }),
    });

    console.log(`date: ${date}`);

    const success = agentResult.success && date === "03-27-2023";

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
