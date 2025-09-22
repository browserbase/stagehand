import { EvalFunction } from "@/types/evals";
import { Evaluator } from "../../evaluator";

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
  input,
  agent,
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

    const result = await agent.execute({
      instruction: params.ques,
      maxSteps: Number(process.env.AGENT_EVAL_MAX_STEPS) || 50,
    });

    const expected = (params as Record<string, unknown>).expected as
      | string
      | undefined;
    const evaluator = new Evaluator(stagehand);
    const evalResult = await evaluator.ask({
      question: `Did the agent provide the expected answer: "${expected}"?`,
      answer: result?.message || "",
      screenshot: false,
    });

    return {
      _success: evalResult.evaluation === "YES",
      reasoning: evalResult.reasoning,
      expectedAnswer: expected,
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
