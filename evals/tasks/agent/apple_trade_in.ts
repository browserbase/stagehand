//this eval is expected to fail due to issues scrolling within the trade in dialog
import { EvalFunction } from "@/types/evals";
import { z } from "zod";

export const apple_trade_in: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
  agent,
}) => {
  try {
    await stagehand.page.goto("https://www.apple.com/shop/trade-in");
    const agentResult = await agent.execute({
      instruction:
        "Find out the trade-in value for an iPhone 13 Pro Max in good condition on the Apple website.",
      maxSteps: 30,
    });

    const { tradeInValue } = await stagehand.page.extract({
      modelName: "google/gemini-2.5-flash",
      instruction:
        "Extract the trade-in value for an iPhone 13 Pro Max in good condition on the Apple website. it will be inside this text : Get x trade-in credit toward a new iPhone', provide just the number",
      schema: z.object({
        tradeInValue: z.number(),
      }),
    });

    const success =
      tradeInValue === 360 &&
      stagehand.page.url().includes("https://www.apple.com/shop/trade-in");

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
