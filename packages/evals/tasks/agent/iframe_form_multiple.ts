import { EvalFunction } from "../../types/evals";
import { V3Evaluator } from "@natewong1313/stagehand";

export const iframe_form_multiple: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  logger,
  agent,
  v3,
}) => {
  try {
    const page = v3.context.pages()[0];
    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/iframe-form-filling/",
    );

    const agentResult = await agent.execute({
      instruction:
        "Fill in the form name with 'John Smith', the email with 'john.smith@example.com', and select the 'Are you the domain owner?' option as 'No'",
      maxSteps: Number(process.env.AGENT_EVAL_MAX_STEPS) || 10,
    });
    logger.log(agentResult);

    await page.scroll(0, 0, 0, -1000);
    const evaluator = new V3Evaluator(v3);
    const results = await evaluator.batchAsk({
      questions: [
        { question: "Is the form name input filled with 'John Smith'?" },
        {
          question:
            "Is the form email input filled with 'john.smith@example.com'?",
        },
      ],
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
    await v3.close();
  }
};
