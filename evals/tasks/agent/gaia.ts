import { EvalFunction, ErrorType } from "@/types/evals";
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
  modelName,
  input,
}) => {
  const startTime = Date.now();
  let agentSteps = 0;

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
        error_type: ErrorType.SETUP_ERROR,
        error_message: "Required parameters 'web' and 'ques' are missing",
        execution_time: Date.now() - startTime,
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

    let result;
    try {
      const maxSteps = Number(process.env.AGENT_EVAL_MAX_STEPS) || 50;
      result = await agent.execute({
        instruction: params.ques,
        maxSteps: maxSteps,
      });
      // For now, we don't have exact step count, but can estimate based on execution
      agentSteps = maxSteps; // This is an upper bound estimate
    } catch (agentError) {
      logger.error({
        category: "gaia",
        level: 0,
        message: `Agent execution failed`,
        auxiliary: {
          error: {
            value:
              agentError instanceof Error
                ? agentError.message
                : String(agentError),
            type: "string",
          },
        },
      });
      return {
        _success: false,
        error: agentError,
        error_type: ErrorType.AGENT_FAILURE,
        error_message:
          agentError instanceof Error
            ? agentError.message
            : "Agent execution failed",
        error_stack: agentError instanceof Error ? agentError.stack : undefined,
        execution_time: Date.now() - startTime,
        agent_steps: agentSteps,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }

    const expected = (params as Record<string, unknown>).expected as
      | string
      | undefined;
    const evaluator = new Evaluator(stagehand);

    let evalResult;
    try {
      evalResult = await evaluator.ask({
        question: `Did the agent provide the expected answer: "${expected}"?`,
        answer: result?.message || "",
        screenshot: false,
      });
    } catch (evalError) {
      logger.error({
        category: "gaia",
        level: 0,
        message: `Evaluator failed`,
        auxiliary: {
          error: {
            value:
              evalError instanceof Error
                ? evalError.message
                : String(evalError),
            type: "string",
          },
        },
      });
      return {
        _success: false,
        error: evalError,
        error_type: ErrorType.EVALUATION_ERROR,
        error_message:
          evalError instanceof Error ? evalError.message : "Evaluation failed",
        error_stack: evalError instanceof Error ? evalError.stack : undefined,
        execution_time: Date.now() - startTime,
        agent_steps: agentSteps,
        final_answer: result?.message,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }

    return {
      _success: evalResult.evaluation === "YES",
      reasoning: evalResult.reasoning,
      final_answer: result?.message,
      execution_time: Date.now() - startTime,
      agent_steps: agentSteps,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } catch (error) {
    // Categorize the error based on its type
    let errorType = ErrorType.UNKNOWN;
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (error instanceof Error) {
      if (
        error.message.includes("timeout") ||
        error.message.includes("Timeout")
      ) {
        errorType = ErrorType.TIMEOUT;
      } else if (
        error.message.includes("network") ||
        error.message.includes("fetch")
      ) {
        errorType = ErrorType.NETWORK;
      } else if (
        error.message.includes("parse") ||
        error.message.includes("JSON")
      ) {
        errorType = ErrorType.PARSING_ERROR;
      }
    }

    logger.error({
      category: "gaia",
      level: 0,
      message: `Unhandled error in GAIA task`,
      auxiliary: {
        error: {
          value: errorMessage,
          type: "string",
        },
        error_type: {
          value: errorType,
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
      error_type: errorType,
      error_message: errorMessage,
      error_stack: error instanceof Error ? error.stack : undefined,
      execution_time: Date.now() - startTime,
      agent_steps: agentSteps,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  }
};
