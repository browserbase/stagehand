import { EvalFunction } from "@/types/evals";
import { Evaluator } from "../../evaluator";
import { z } from "zod";

export const google_maps_2: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
  modelName,
}) => {
  try {
    await stagehand.page.goto("https://maps.google.com");

    const agent = stagehand.agent({
      model: modelName,
      provider: modelName.startsWith("claude") ? "anthropic" : "openai",
      instructions: `You are a helpful assistant that can help me with my tasks. You are given a task and you need to complete it without asking follow up questions. The current page is ${await stagehand.page.title()}`,
    });

    const agentResult = await agent.execute({
      instruction:
        "Search for the fastest walking route from La Puerta de Alcalá to La Puerta del Sol",
      maxSteps: 15,
    });
    logger.log(agentResult);

    const evaluator = new Evaluator(stagehand);
    const result = await evaluator.evaluate({
      question:
        "Does the page show the fastest walking route from La Puerta de Alcalá to La Puerta del Sol? Does the distance between the two points show as 1.5 km?",
    });
    const { distance } = await stagehand.page.extract({
      modelName: "google/gemini-2.5-flash",
      instruction:
        "Extract the distance for the fastest route walking to the decimal",
      schema: z.object({
        distance: z
          .number()
          .describe("The distance between the two destinations in km"),
      }),
    });

    if (result.evaluation !== "YES" && result.evaluation !== "NO") {
      return {
        _success: false,
        observations: "Evaluator provided an invalid response",
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }

    if (result.evaluation === "YES") {
      if (distance !== 1.5) {
        return {
          _success: false,
          observations: "Distance is not 1.5 km",
          debugUrl,
          sessionUrl,
          logs: logger.getLogs(),
        };
      }
      return {
        _success: true,
        observations: result.reasoning,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } else {
      return {
        _success: false,
        observations: result.reasoning,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }
  } catch (error) {
    return {
      _success: false,
      error: error,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } finally {
    await stagehand.close();
  }
};
