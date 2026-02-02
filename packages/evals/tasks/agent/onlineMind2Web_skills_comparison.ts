import { EvalFunction } from "../../types/evals";
import { runSkillAgent, SKILL_CONFIGS, getAvailableSkills } from "../../lib/skillAgents";
import { SkillsEvaluator } from "../../lib/SkillsEvaluator";
import dotenv from "dotenv";

dotenv.config();

/**
 * Extract agent reasoning from the agent messages.
 * Looks for the final assistant message and extracts text content.
 */
function extractAgentReasoning(agentMessages: any[]): string {
  const reasoningParts: string[] = [];

  for (const msg of agentMessages) {
    if (msg.type === "assistant") {
      const content = msg.message?.content;
      if (content) {
        for (const block of content) {
          if (block.type === "text") {
            reasoningParts.push(block.text);
          } else if (block.type === "tool_use") {
            reasoningParts.push(`[Tool: ${block.name}] ${JSON.stringify(block.input).substring(0, 200)}`);
          }
        }
      }
    }
  }

  // Return last N characters to keep context manageable
  const fullReasoning = reasoningParts.join("\n");
  const maxLength = 4000;
  if (fullReasoning.length > maxLength) {
    return "..." + fullReasoning.slice(-maxLength);
  }
  return fullReasoning;
}

export const onlineMind2Web_skills_comparison: EvalFunction = async ({
  logger,
  debugUrl,
  sessionUrl,
  input,
}) => {
  const evalStartTime = Date.now();

  const params = input.params as {
    skill: string;
    task: string;
    website: string;
    task_id?: string;
    difficulty?: string;
  };
  const { skill, task, website } = params;

  logger.log({
    message: `Running skill: ${skill} on task`,
    level: 1,
    auxiliary: {
      task: { value: task, type: "string" },
      website: { value: website, type: "string" },
    },
  });

  // Run the skill agent
  const result = await runSkillAgent(skill, task, {
    startUrl: website,
    maxTurns: 30,
    maxBudgetUsd: 5.0,
  });

  // Log all agent messages to Braintrust
  for (const msg of result.agentMessages) {
    if (msg.type === "assistant") {
      const content = msg.message?.content;
      if (content) {
        for (const block of content) {
          if (block.type === "text") {
            logger.log({
              message: `[Assistant] ${block.text}`,
              level: 1,
            });
          } else if (block.type === "tool_use") {
            logger.log({
              message: `[Tool: ${block.name}] ${JSON.stringify(block.input).substring(0, 500)}`,
              level: 1,
            });
          }
        }
      }
    } else if (msg.type === "user") {
      const content = msg.message?.content;
      if (content) {
        for (const block of content) {
          if (block.type === "tool_result") {
            const resultStr = typeof block.content === "string"
              ? block.content.substring(0, 1000)
              : JSON.stringify(block.content).substring(0, 1000);
            logger.log({
              message: `[Tool Result] ${resultStr}`,
              level: 1,
            });
          }
        }
      }
    }
  }

  logger.log({
    message: `Skill ${skill} completed in ${result.metrics.durationMs}ms with ${result.metrics.turns} turns`,
    level: 1,
    auxiliary: {
      success: { value: result.success.toString(), type: "string" },
      costUsd: { value: result.metrics.costUsd.toFixed(4), type: "string" },
      turns: { value: result.metrics.turns.toString(), type: "integer" },
      screenshotCount: { value: result.screenshots.length.toString(), type: "integer" },
      inputTokens: { value: result.metrics.inputTokens.toString(), type: "integer" },
      outputTokens: { value: result.metrics.outputTokens.toString(), type: "integer" },
      durationMs: { value: result.metrics.durationMs.toString(), type: "integer" },
    },
  });

  // If we have screenshots, use the LLM evaluator for more accurate assessment
  let evaluationResult: { evaluation: string; reasoning: string } | null = null;

  if (result.screenshots.length > 0) {
    try {
      const evaluator = new SkillsEvaluator();
      const agentReasoning = extractAgentReasoning(result.agentMessages);

      logger.log({
        message: `Evaluating task completion with ${result.screenshots.length} screenshots`,
        level: 1,
      });

      evaluationResult = await evaluator.evaluateWithMultipleScreenshots({
        question: `Did the agent successfully complete this task: "${task}"?`,
        screenshots: result.screenshots,
        agentReasoning,
      });

      logger.log({
        message: `Evaluation result: ${evaluationResult.evaluation}`,
        level: 1,
        auxiliary: {
          evaluation: { value: evaluationResult.evaluation, type: "string" },
          reasoning: { value: evaluationResult.reasoning.substring(0, 500), type: "string" },
        },
      });
    } catch (error) {
      logger.log({
        message: `Evaluation failed: ${error}`,
        level: 1,
      });
      // Fall back to agent's success flag if evaluation fails
    }
  } else {
    logger.log({
      message: "No screenshots collected, using agent success flag for evaluation",
      level: 1,
    });
  }

  // Determine final success based on evaluation or agent result
  const isSuccess = evaluationResult
    ? evaluationResult.evaluation === "YES"
    : result.success;

  // Calculate total eval runtime
  const totalEvalRuntimeMs = Date.now() - evalStartTime;

  // Log final metrics summary with tokens and runtime
  logger.log({
    message: "Eval completed",
    level: 1,
    auxiliary: {
      totalEvalRuntimeMs: { value: totalEvalRuntimeMs.toString(), type: "integer" },
      agentDurationMs: { value: result.metrics.durationMs.toString(), type: "integer" },
      inputTokens: { value: result.metrics.inputTokens.toString(), type: "integer" },
      outputTokens: { value: result.metrics.outputTokens.toString(), type: "integer" },
      totalTokens: { value: (result.metrics.inputTokens + result.metrics.outputTokens).toString(), type: "integer" },
      costUsd: { value: result.metrics.costUsd.toFixed(4), type: "string" },
      success: { value: isSuccess.toString(), type: "string" },
    },
  });

  // Return result for Braintrust
  return {
    _success: isSuccess,
    logs: logger.getLogs(),
    debugUrl: result.browserbaseDebugUrl || debugUrl,
    sessionUrl: result.browserbaseSessionUrl || sessionUrl,
    error: result.error,
    evaluation: evaluationResult ? {
      result: evaluationResult.evaluation,
      reasoning: evaluationResult.reasoning,
    } : undefined,
    metrics: {
      ...result.metrics,
      screenshotCount: result.screenshots.length,
      totalEvalRuntimeMs,
    },
    task_level: params.difficulty,
  };
};

// Export skill configs for the test suite
export { SKILL_CONFIGS, getAvailableSkills };
