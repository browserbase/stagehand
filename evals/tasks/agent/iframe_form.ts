import { EvalFunction } from "@/types/evals";
import { Evaluator } from "../../evaluator";

export const iframe_form: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
  modelName,
}) => {
  try {
    await stagehand.page.goto("https://tucowsdomains.com/abuse-form/phishing/");

    const agent = stagehand.agent({
      provider: "anthropic",
      model: modelName,
    });

    const agentResult = await agent.execute({
      instruction: "Fill in the form name with 'John Smith'",
      maxSteps: 3,
    });
    logger.log(agentResult);

    await stagehand.page.mouse.wheel(0, -1000);
    const evaluator = new Evaluator(stagehand);
    const result = await evaluator.evaluate({
      question: "Is the form name input filled with 'John Smith'?",
      strictResponse: true,
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

    const agentResult2 = await agent.execute({
      instruction: "Fill in the form email with 'john.smith@example.com'",
      maxSteps: 3,
    });
    logger.log(agentResult2);

    await stagehand.page.mouse.wheel(0, -1000);
    const result2 = await evaluator.evaluate({
      question: "Is the form email input filled with 'john.smith@example.com'?",
      strictResponse: true,
    });

    if (result2.evaluation !== "YES" && result2.evaluation !== "NO") {
      return {
        _success: false,
        observations: "Evaluator provided an invalid response",
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }

    if (result.evaluation === "YES" && result2.evaluation === "YES") {
      return {
        _success: true,
        observations: "All fields were filled correctly",
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } else {
      return {
        _success: false,
        observations: "One or more fields were not filled correctly",
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
