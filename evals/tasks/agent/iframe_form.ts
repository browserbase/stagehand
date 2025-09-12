import { EvalFunction } from "@/types/evals";
import { V3Evaluator } from "@/evals/v3Evaluator";

export const iframe_form: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  logger,
  v3Agent,
  v3,
}) => {
  try {
    const page = v3.context.pages()[0];
    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/iframe-form-filling/",
    );

    const agentResult = await v3Agent.execute({
      instruction: "Fill in the form name with 'John Smith'",
      maxSteps: Number(process.env.AGENT_EVAL_MAX_STEPS) || 5,
    });
    logger.log(agentResult);

    const evaluator = new V3Evaluator(v3);
    const result = await evaluator.ask({
      question: "Is the form name input filled with 'John Smith'?",
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

    const agentResult2 = await v3Agent.execute({
      instruction: "Fill in the form email with 'john.smith@example.com'",
      maxSteps: Number(process.env.AGENT_EVAL_MAX_STEPS) || 3,
    });
    logger.log(agentResult2);

    await page.scroll(0, 0, 0, -1000);
    const result2 = await evaluator.ask({
      question: "Is the form email input filled with 'john.smith@example.com'?",
      screenshot: true,
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
    await v3.close();
  }
};
