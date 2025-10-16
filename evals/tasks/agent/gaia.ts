import { EvalFunction } from "@/types/evals";
import { Evaluator } from "../../evaluator";
import { modelToAgentProviderMap } from "@/lib/agent/AgentProvider";
import { loadApiKeyFromEnv } from "@/lib/utils";
import dotenv from "dotenv";

dotenv.config();
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

  try {
    const params = ((input && input.params) || {}) as {
      id?: string;
      level?: number;
      web?: string;
      ques?: string;
    };

    if (!params.web || !params.ques) {
      return {
        _success: false,
        error: `Missing GAIA params (web, ques). Got: ${JSON.stringify(params)}`,
        execution_time: Date.now() - startTime,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }
    await stagehand.page.goto(params.web, {
      timeout: 120_000,
    });

    if (!(modelName in modelToAgentProviderMap)) {
      return {
        _success: false,
        error: `Model ${modelName} is not supported for agent tasks. Supported models: ${Object.keys(modelToAgentProviderMap).join(", ")}`,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }

    const provider = modelToAgentProviderMap[modelName];
    const agent = stagehand.agent({
      model: modelName,
      provider,
      instructions: `You are a helpful assistant that must solve the task by browsing. At the end, produce a single line: "Final Answer: <answer>" summarizing the requested result (e.g., score, list, or text). Current page: ${await stagehand.page.title()}. ALWAYS OPERATE WITHIN THE PAGE OPENED BY THE USER, WHICHEVER TASK YOU ARE ATTEMPTING TO COMPLETE CAN BE ACCOMPLISHED WITHIN THE PAGE.`,
      options: {
        apiKey: loadApiKeyFromEnv(provider, stagehand.logger),
      },
    });

    const maxSteps = Number(process.env.AGENT_EVAL_MAX_STEPS) || 50;
    const result = await agent.execute({
      instruction: params.ques,
      maxSteps: maxSteps,
    });
    logger.log(result);

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
      throw evalError; // Let index.eval.ts handle error categorization
    }

    return {
      _success: evalResult.evaluation === "YES",
      reasoning: evalResult.reasoning,
      final_answer: result?.message,
      execution_time: Date.now() - startTime,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } finally {
    stagehand.close();
  }
};
