import { EvalFunction } from "@/types/evals";
import { Evaluator } from "../../evaluator";
import { z } from "zod";

export const google_maps_2: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
  agent,
}) => {
  try {
    await stagehand.page.goto("https://maps.google.com");

    const agentResult = await agent.execute({
      instruction:
        "Search for the fastest walking route from La Puerta de Alcalá to La Puerta del Sol",
      maxSteps: Number(process.env.AGENT_EVAL_MAX_STEPS) || 20,
    });
    logger.log(agentResult);

    const evaluator = new Evaluator(stagehand);
    const result = await evaluator.ask({
      question:
        "Does the page show the fastest walking route from La Puerta de Alcalá to La Puerta del Sol?",
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
      if (distance <= 1.3 || distance >= 1.6) {
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
