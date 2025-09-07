import { EvalFunction } from "@/types/evals";
import { Evaluator } from "../../evaluator";

export const webbench: EvalFunction = async ({
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
      url?: string;
      category?: string;
      difficulty?: string;
      task?: string;
    };

    if (!params.url || !params.task) {
      logger.error({
        category: "webbench",
        level: 0,
        message: `Missing WebBench params (url, task).`,
        auxiliary: {
          params: { value: JSON.stringify(params), type: "object" },
        },
      });
      return {
        _success: false,
        error: `Missing WebBench params (url, task). Got: ${JSON.stringify(params)}`,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }

    await stagehand.page.goto(params.url, { waitUntil: "domcontentloaded" });

    logger.log({
      category: "webbench",
      message: `Starting WebBench task ${params.id}`,
      level: 1,
      auxiliary: {
        category: {
          value: params.category || "unknown",
          type: "string",
        },
        difficulty: {
          value: params.difficulty || "unknown",
          type: "string",
        },
        url: {
          value: params.url,
          type: "string",
        },
        task_preview: {
          value: params.task.substring(0, 100) + "...",
          type: "string",
        },
      },
    });

    // Execute the task using agent
    const agent = stagehand.agent({
      model: modelName,
      provider: modelName.startsWith("claude") ? "anthropic" : "openai",
      instructions: `You are a helpful assistant that must complete the given task by browsing the website. Current page: ${await stagehand.page.title()}`,
    });

    const result = await agent.execute({
      instruction: params.task,
      maxSteps: Number(process.env.AGENT_EVAL_MAX_STEPS) || 50,
    });

    // Log the result
    logger.log({
      category: "webbench",
      message: `Task ${params.id} completed`,
      level: 1,
      auxiliary: {
        task_id: {
          value: params.id || "unknown",
          type: "string",
        },
        has_result: {
          value: (!!result).toString(),
          type: "string",
        },
      },
    });

    // Use evaluator to determine success based on task requirements
    const evaluator = new Evaluator(stagehand);

    // For READ tasks, check if information was extracted
    // For CREATE/UPDATE/DELETE tasks, check if action was completed
    let evalPrompt = "";
    if (params.category === "READ") {
      evalPrompt = `Did the agent successfully extract or find the requested information as specified in the task: "${params.task}"?`;
    } else if (params.category === "CREATE") {
      evalPrompt = `Did the agent successfully create what was requested in the task: "${params.task}"?`;
    } else if (params.category === "UPDATE") {
      evalPrompt = `Did the agent successfully update what was requested in the task: "${params.task}"?`;
    } else if (params.category === "DELETE") {
      evalPrompt = `Did the agent successfully delete what was requested in the task: "${params.task}"?`;
    } else if (params.category === "FILE_MANIPULATION") {
      evalPrompt = `Did the agent successfully complete the file manipulation task: "${params.task}"?`;
    } else {
      evalPrompt = `Did the agent successfully complete the task: "${params.task}"?`;
    }

    const evalResult = await evaluator.ask({
      question: evalPrompt,
      answer: result?.message || "",
      screenshot: true,
    });

    return {
      _success: evalResult.evaluation === "YES",
      reasoning: evalResult.reasoning,
      task_id: params.id,
      category: params.category,
      difficulty: params.difficulty || "unknown",
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } catch (error) {
    logger.error({
      category: "webbench",
      level: 0,
      message: `Unhandled error in WebBench task`,
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
