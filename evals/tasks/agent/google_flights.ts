import { EvalFunction } from "@/types/evals";
import { Evaluator } from "../../evaluator";

export const google_flights: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
  modelName,
}) => {
  await stagehand.page.goto("https://google.com/travel/flights");

  const agent = stagehand.agent({
    model: modelName,
    provider: modelName.startsWith("claude") ? "anthropic" : "openai",
    instructions: `You are a helpful assistant that can help me with my tasks. You are given a task and you need to complete it without asking follow up questions. Today is ${new Date().toISOString().slice(0, 10)}. The current page is ${await stagehand.page.title()}`,
  });

  const agentResult = await agent.execute({
    instruction:
      "Search for flights from San Francisco to New York for next weekend",
    maxSteps: 15,
  });
  logger.log(agentResult);

  const evaluator = new Evaluator(stagehand);
  const result = await evaluator.evaluate({
    question:
      "Does the page show flights (options, available flights, not a search form) from San Francisco to New York?",
    strictResponse: true,
  });

  if (result.evaluation !== "YES" && result.evaluation !== "NO") {
    await stagehand.close();
    return {
      _success: false,
      observations: "Evaluator provided an invalid response",
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  }

  if (result.evaluation === "YES") {
    await stagehand.close();
    return {
      _success: true,
      observations: result.reasoning,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } else {
    await stagehand.close();
    return {
      _success: false,
      observations: result.reasoning,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  }
};
