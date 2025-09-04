import { EvalFunction } from "@/types/evals";

export const sign_in: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
  agent,
}) => {
  try {
    await stagehand.page.goto("https://v0-modern-login-flow.vercel.app/");

    const agentResult = await agent.execute({
      instruction:
        "Sign in with the email address 'test@browserbaser.com' and the password 'stagehand=goated' ",
      maxSteps: Number(process.env.AGENT_EVAL_MAX_STEPS) || 15,
    });
    logger.log(agentResult);
    const url = await stagehand.page.url();

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
    await stagehand.close();
  }
};
