import { EvalFunction } from "@/types/evals";
import { Evaluator } from "../../evaluator";

export const iframe_form_multiple: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
  modelName,
}) => {
  try {
    await stagehand.page.goto("https://tucowsdomains.com/abuse-form/phishing/");

    const agent = stagehand.agent({
      provider: modelName.startsWith("claude") ? "anthropic" : "openai",
      model: modelName,
    });

    const agentResult = await agent.execute({
      instruction:
        "Fill in the form name with 'John Smith', the email with 'john.smith@example.com', and select the 'Are you the domain owner?' option as 'No'",
      maxSteps: 10,
    });
    logger.log(agentResult);

    await stagehand.page.mouse.wheel(0, -1000);
    const evaluator = new Evaluator(stagehand);
    const results = await evaluator.batchEvaluate({
      questions: [
        "Is the form name input filled with 'John Smith'?",
        "Is the form email input filled with 'john.smith@example.com'?",
        "Is the 'Are you the domain owner?' option selected as 'No'?",
      ],
      strictResponse: true,
    });

    for (const r of results) {
      if (r.evaluation !== "YES" && r.evaluation !== "NO") {
        return {
          _success: false,
          observations: "Evaluator provided an invalid response",
          debugUrl,
          sessionUrl,
          logs: logger.getLogs(),
        };
      }
      if (r.evaluation === "NO") {
        return {
          _success: false,
          observations: r.reasoning,
          debugUrl,
          sessionUrl,
          logs: logger.getLogs(),
        };
      }
    }

    return {
      _success: true,
      observations: "All fields were filled correctly",
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
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
