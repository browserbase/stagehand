import { EvalFunction } from "../../types/evals";
import { V3Evaluator } from "@browserbasehq/stagehand";

export const hugging_face: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  logger,
  agent,
  v3,
}) => {
  try {
    const evaluator = new V3Evaluator(v3);
    const page = v3.context.pages()[0];
    await page.goto("https://huggingface.co/");
    const agentResult = await agent.execute({
      instruction:
        "Search for a model on Hugging Face with an Apache-2.0 license that has received the highest number of likes.",
      maxSteps: Number(process.env.AGENT_EVAL_MAX_STEPS) || 20,
    });
    console.log(`agentResult: ${agentResult.message}`);
    const { evaluation, reasoning } = await evaluator.ask({
      question:
        "Does the message mention 'kokoro-82m' or 'hexgrad/Kokoro-82M'?",
      answer: agentResult.message || "",
      screenshot: false,
    });

    const success = evaluation === "YES";

    console.log(`reasoning: ${reasoning}`);
    if (!success) {
      return {
        _success: false,
        message: reasoning,
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
    await v3.close();
  }
};
