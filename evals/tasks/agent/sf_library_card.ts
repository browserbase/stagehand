import { EvalFunction } from "@/types/evals";
import { Evaluator } from "../../evaluator";

export const sf_library_card: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
  modelName,
}) => {
  await stagehand.page.goto("https://sflib1.sfpl.org/selfreg");

  const agent = stagehand.agent({
    model: modelName,
    provider: modelName.startsWith("claude") ? "anthropic" : "openai",
    instructions: `You are a helpful assistant that can help me with my tasks. You are given a task and you need to complete it without asking follow up questions. The current page is ${await stagehand.page.title()}`,
  });

  const agentResult = await agent.execute({
    instruction: "Fill in the 'Residential Address' field with '166 Geary St'",
    maxSteps: 3,
  });
  logger.log(agentResult);

  await stagehand.page.mouse.wheel(0, -1000);
  const evaluator = new Evaluator(stagehand);
  const result = await evaluator.evaluate({
    question:
      "Does the page show the 'Residential Address' field filled with '166 Geary St'?",
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
