import { EvalFunction } from "@/types/evals";

/**
 * Data-driven GAIA agent eval
 * - Expects per-test params injected via eval runner: { id, level, web, ques }
 * - Starts at `web`, runs the agent with `ques` as instruction
 * - Requires the agent to output a final answer in the form: "Final Answer: <value>"
 * - Marks success if such an answer string is present (exact matching against dataset can be layered later)
 */
export const gaia: EvalFunction = async ({
  stagehand,
  logger,
  debugUrl,
  sessionUrl,
  modelName,
  input,
}) => {
  try {
    const params = ((input && input.params) || {}) as {
      id?: string;
      level?: number;
      web?: string;
      ques?: string;
    };

    if (!params.web || !params.ques) {
      logger.error({
        category: "gaia",
        level: 0,
        message: `Missing GAIA params (web, ques).`,
        auxiliary: {
          params: { value: JSON.stringify(params), type: "object" },
        },
      });
      return {
        _success: false,
        error: `Missing GAIA params (web, ques). Got: ${JSON.stringify(params)}`,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }

    await stagehand.page.goto(params.web);

    const agent = stagehand.agent({
      model: modelName,
      provider: modelName.startsWith("claude") ? "anthropic" : "openai",
      instructions: `You are a helpful assistant that must solve the task by browsing. You must produce a single line at the end like: "Final Answer: <answer>". Do not ask follow up questions. Current page: ${await stagehand.page.title()}`,
    });

    const result = await agent.execute({
      instruction: params.ques,
      maxSteps: 20,
    });

    const message = result?.message || "";
    const hasFinal =
      typeof message === "string" && /Final Answer\s*:\s*(.+)/i.test(message);
    const providedAnswer = hasFinal
      ? (message.match(/Final Answer\s*:\s*(.+)/i)?.[1] || "").trim()
      : "";

    const expected = (params as Record<string, unknown>).expected as
      | string
      | undefined;
    const success = expected
      ? hasFinal && providedAnswer.trim() === expected.trim()
      : hasFinal;

    return {
      _success: !!success,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } catch (error) {
    logger.error({
      category: "gaia",
      level: 0,
      message: `Unhandled error in GAIA task`,
      auxiliary: {
        error: {
          value: error instanceof Error ? error.message : String(error),
          type: "string",
        },
        trace: {
          value: error instanceof Error && error.stack ? error.stack : "",
          type: "string",
        },
      },
    });
    return {
      _success: false,
      error,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  }
};
