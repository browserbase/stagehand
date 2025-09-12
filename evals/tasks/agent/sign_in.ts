import { EvalFunction } from "@/types/evals";

export const sign_in: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  logger,
  v3Agent,
  v3,
}) => {
  try {
    const page = v3.context.pages()[0];
    await page.goto("https://v0-modern-login-flow.vercel.app/");

    const agentResult = await v3Agent.execute({
      instruction:
        "Sign in with the email address 'test@browserbaser.com' and the password 'stagehand=goated' ",
      maxSteps: Number(process.env.AGENT_EVAL_MAX_STEPS) || 15,
    });
    logger.log(agentResult);
    const url = await page.url();

    if (url === "https://v0-modern-login-flow.vercel.app/authorized") {
      return {
        _success: true,
        observations: url,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }

    return {
      _success: false,
      observations: url,
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
