import { EvalFunction } from "@/types/evals";
import type { OSWorldStagehandTask } from "../../datasets/osworld/types";
import { Stagehand } from "@/dist";
import { EvalLogger } from "../../logger";
import { ScreenshotCollector } from "../../utils/ScreenshotCollector";
import { z } from "zod/v3";

export const osworld: EvalFunction = async ({
  stagehand,
  logger,
  debugUrl,
  sessionUrl,
  input,
  agent,
}) => {
  try {
    const params = (input && input.params) as unknown as
      | OSWorldStagehandTask
      | undefined;

    if (!params) {
      logger.error({
        category: "osworld",
        level: 0,
        message: `No params provided in input.`,
        auxiliary: {
          input: { value: JSON.stringify(input), type: "object" },
        },
      });
      return {
        _success: false,
        error: `No params provided in input.`,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }

    if (!params.id || !params.instruction) {
      logger.error({
        category: "osworld",
        level: 0,
        message: `Missing OSWorld params (id, instruction).`,
        auxiliary: {
          params: { value: JSON.stringify(params), type: "object" },
        },
      });
      return {
        _success: false,
        error: `Missing OSWorld params (id, instruction). Got: ${JSON.stringify(params)}`,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }

    logger.log({
      category: "osworld",
      message: `Starting OSWorld task ${params.id}`,
      level: 1,
      auxiliary: {
        source: {
          value: params.source || "unknown",
          type: "string",
        },
        evaluation_type: {
          value: params.evaluationType,
          type: "string",
        },
        start_url: {
          value: params.startUrl || "none",
          type: "string",
        },
        instruction_preview: {
          value: params.instruction.substring(0, 100) + "...",
          type: "string",
        },
      },
    });

    // Navigate to starting URL if provided
    if (params.startUrl) {
      await stagehand.page.goto(params.startUrl, {
        waitUntil: "domcontentloaded",
      });
    }

    // Set timeout for task execution
    const timeout = params.timeout || 60000; // Default 60 seconds

    // Start collecting screenshots
    const screenshotCollector = new ScreenshotCollector(stagehand.page, {
      maxScreenshots: 8, // Keep last 8 screenshots
    });

    // Set the collector on the agent so it captures screenshots
    if (agent.setScreenshotCollector) {
      agent.setScreenshotCollector(screenshotCollector);
    }

    screenshotCollector.start();

    // Execute the task using the pre-initialized agent with timeout
    const executionPromise = agent.execute({
      instruction: params.instruction,
      maxSteps: Number(process.env.AGENT_EVAL_MAX_STEPS) || 50,
    });

    // Apply timeout wrapper
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`Task timed out after ${timeout}ms`)),
        timeout,
      ),
    );

    await Promise.race([executionPromise, timeoutPromise]);
    // Always stop collecting and get all screenshots, even on error
    const screenshots = screenshotCollector.stop();

    logger.log({
      category: "evaluation",
      message: `Collected ${screenshots.length} screenshots for evaluation`,
      level: 1,
    });

    // Evaluate based on OSWorld evaluation type
    const success = await evaluateOSWorldTask(stagehand, params, logger);

    return {
      _success: success.passed,
      reasoning: success.reasoning,
      task_id: params.id,
      source: params.source,
      evaluation_type: params.evaluationType,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } catch (error) {
    logger.error({
      category: "osworld",
      level: 0,
      message: `Unhandled error in OSWorld task`,
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

/**
 * Evaluate OSWorld task based on evaluation criteria
 */
async function evaluateOSWorldTask(
  stagehand: Stagehand,
  params: OSWorldStagehandTask,
  logger: EvalLogger,
): Promise<{ passed: boolean; reasoning: string }> {
  const { evaluationType, evaluationCriteria } = params;

  try {
    switch (evaluationType) {
      case "url_match":
        return await evaluateUrlMatch(stagehand, evaluationCriteria, logger);

      case "string_match":
        return await evaluateStringMatch(stagehand, evaluationCriteria, logger);

      case "dom_state":
        return await evaluateDomState(stagehand, evaluationCriteria, logger);

      case "custom":
        return await evaluateCustom(stagehand, evaluationCriteria, logger);

      default:
        return {
          passed: false,
          reasoning: `Unknown evaluation type: ${evaluationType}`,
        };
    }
  } catch (error) {
    logger.error({
      category: "osworld_evaluation",
      level: 0,
      message: "Error during task evaluation",
      auxiliary: {
        error: { value: String(error), type: "string" },
      },
    });
    return {
      passed: false,
      reasoning: `Evaluation error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function evaluateUrlMatch(
  stagehand: Stagehand,
  criteria: OSWorldStagehandTask["evaluationCriteria"],
  logger: EvalLogger,
): Promise<{ passed: boolean; reasoning: string }> {
  const currentUrl = stagehand.page.url();
  const expectedUrl =
    criteria.rules?.url ||
    ((criteria.expected as Record<string, unknown>)?.url as string);

  if (!expectedUrl) {
    return {
      passed: false,
      reasoning: "No expected URL specified in evaluation criteria",
    };
  }

  // Check if URL matches (can be exact match or prefix match depending on rules)
  const matches =
    currentUrl === expectedUrl || currentUrl.includes(expectedUrl);

  logger.log({
    category: "osworld_evaluation",
    message: "URL match evaluation",
    level: 1,
    auxiliary: {
      current_url: { value: currentUrl, type: "string" },
      expected_url: { value: expectedUrl, type: "string" },
      matches: { value: matches.toString(), type: "string" },
    },
  });

  return {
    passed: matches,
    reasoning: matches
      ? `URL matches expected: ${currentUrl}`
      : `URL mismatch. Expected: ${expectedUrl}, Got: ${currentUrl}`,
  };
}

async function evaluateStringMatch(
  stagehand: Stagehand,
  criteria: OSWorldStagehandTask["evaluationCriteria"],
  logger: EvalLogger,
): Promise<{ passed: boolean; reasoning: string }> {
  const expectedString =
    (criteria.expected as Record<string, unknown>)?.expected ||
    (criteria.expected as string);

  if (!expectedString) {
    return {
      passed: false,
      reasoning: "No expected string specified in evaluation criteria",
    };
  }

  // Extract page content to check for string presence
  const pageContent = await stagehand.page.content();
  const matches = pageContent.includes(String(expectedString));

  logger.log({
    category: "osworld_evaluation",
    message: "String match evaluation",
    level: 1,
    auxiliary: {
      expected_string: { value: String(expectedString), type: "string" },
      matches: { value: matches.toString(), type: "string" },
    },
  });

  return {
    passed: matches,
    reasoning: matches
      ? `Found expected string: ${expectedString}`
      : `String not found: ${expectedString}`,
  };
}

async function evaluateDomState(
  stagehand: Stagehand,
  criteria: OSWorldStagehandTask["evaluationCriteria"],
  logger: EvalLogger,
): Promise<{ passed: boolean; reasoning: string }> {
  // For DOM state evaluation, we'll extract specific elements and check their state
  // This is a simplified implementation - can be expanded based on specific OSWorld requirements

  const expected = criteria.expected;

  if (!expected) {
    return {
      passed: false,
      reasoning: "No expected DOM state specified in evaluation criteria",
    };
  }

  try {
    // Use Stagehand's extract to check for specific DOM elements
    const extractResult = await stagehand.page.extract({
      instruction: `Check if the page contains the expected DOM state. Expected criteria: ${JSON.stringify(expected)}. Verify if the current page state matches these criteria.`,
      schema: z.object({
        hasExpectedState: z
          .boolean()
          .describe("Whether the expected state is present"),
        details: z.string().describe("Details about what was found"),
      }),
    });

    const passed = extractResult?.hasExpectedState || false;

    logger.log({
      category: "osworld_evaluation",
      message: "DOM state evaluation",
      level: 1,
      auxiliary: {
        expected_criteria: {
          value: JSON.stringify(expected),
          type: "object",
        },
        extract_result: {
          value: JSON.stringify(extractResult),
          type: "object",
        },
        passed: { value: passed.toString(), type: "string" },
      },
    });

    return {
      passed,
      reasoning: extractResult?.details || "DOM state evaluation completed",
    };
  } catch (error) {
    return {
      passed: false,
      reasoning: `DOM evaluation failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function evaluateCustom(
  stagehand: Stagehand,
  criteria: OSWorldStagehandTask["evaluationCriteria"],
  logger: EvalLogger,
): Promise<{ passed: boolean; reasoning: string }> {
  // Custom evaluation - can be extended based on specific OSWorld evaluator functions
  logger.log({
    category: "osworld_evaluation",
    message: "Custom evaluation not fully implemented",
    level: 1,
    auxiliary: {
      criteria_type: { value: criteria.type, type: "string" },
    },
  });

  // For now, return a basic evaluation
  return {
    passed: false,
    reasoning: `Custom evaluation type '${criteria.type}' not yet implemented`,
  };
}
