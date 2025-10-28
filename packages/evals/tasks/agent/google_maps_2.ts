import { EvalFunction } from "../../types/evals";
import { V3Evaluator } from "@browserbasehq/orca";
import type { AvailableModel } from "@browserbasehq/orca";
import { z } from "zod";

export const google_maps_2: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  logger,
  v3Agent,
  v3,
}) => {
  try {
    const page = v3.context.pages()[0];
    await page.goto("https://maps.google.com");

    const agentResult = await v3Agent.execute({
      instruction:
        "Search for the fastest walking route from La Puerta de Alcalá to La Puerta del Sol",
      maxSteps: Number(process.env.AGENT_EVAL_MAX_STEPS) || 20,
    });
    logger.log(agentResult);

    const evaluator = new V3Evaluator(v3);
    const result = await evaluator.ask({
      question:
        "Does the page show the fastest walking route from La Puerta de Alcalá to La Puerta del Sol? Does the distance between the two points show as 1.5 km?",
    });
    const { distance } = await v3.extract(
      "Extract the distance for the fastest route walking to the decimal",
      z.object({
        distance: z
          .number()
          .describe("The distance between the two destinations in km"),
      }),
      { model: "google/gemini-2.5-flash" as AvailableModel },
    );

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
    await v3.close();
  }
};
