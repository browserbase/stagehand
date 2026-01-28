import { EvalFunction } from "../../types/evals";
import { runSkillAgent, SKILL_CONFIGS } from "../../lib/skillAgents";
import { V3Evaluator } from "@browserbasehq/stagehand";
import dotenv from "dotenv";
import type { V3 } from "@browserbasehq/stagehand";

dotenv.config();

export const onlineMind2Web_skills_comparison: EvalFunction = async ({
  logger,
  debugUrl,
  sessionUrl,
  input,
}) => {
  try {
    const params = ((input && input.params) || {}) as {
      task_id?: string;
      confirmed_task?: string;
      website?: string;
      reference_length?: number;
      level?: string;
      skill?: string; // Which skill to use
    };

    if (!params.website || !params.confirmed_task || !params.skill) {
      return {
        _success: false,
        error: `Missing params (website, confirmed_task, skill). Got: ${JSON.stringify(params)}`,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }

    const skillConfig = SKILL_CONFIGS[params.skill];
    if (!skillConfig) {
      return {
        _success: false,
        error: `Unknown skill: ${params.skill}. Available: ${Object.keys(SKILL_CONFIGS).join(", ")}`,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }

    const instruction = `Navigate to ${params.website} and complete: "${params.confirmed_task}"

At the end, produce: "Final Answer: <answer>"`;

    logger.log({
      category: "evaluation",
      message: `Running skill: ${params.skill} on task: ${params.task_id}`,
      level: 1,
    });

    logger.log({
      category: "evaluation",
      message: `Website: ${params.website}`,
      level: 1,
    });

    logger.log({
      category: "evaluation",
      message: `Task: ${params.confirmed_task}`,
      level: 1,
    });

    // Run the agent with the specified skill
    const metrics = await runSkillAgent(instruction, skillConfig);

    logger.log({
      category: "evaluation",
      message: `Skill ${params.skill} completed in ${metrics.durationMs}ms with ${metrics.turnCount} turns`,
      level: 1,
    });

    logger.log({
      category: "evaluation",
      message: `Cost: $${metrics.totalCostUsd.toFixed(4)}, Tokens: ${metrics.inputTokens} in / ${metrics.outputTokens} out`,
      level: 1,
    });

    // Use V3Evaluator to validate the answer (text-only mode, no screenshots from Agent SDK)
    let evaluationSuccess = false;
    let evaluationReasoning = "No evaluation performed";

    if (metrics.reasoning) {
      try {
        // Create a stub V3 instance for V3Evaluator (it only needs the model, not the browser)
        const stubV3 = {
          logger: () => {},
        } as any as V3;

        // Use Anthropic model for evaluation
        const evaluatorModel = "anthropic/claude-sonnet-4-20250514";
        const evaluator = new V3Evaluator(
          stubV3,
          evaluatorModel,
          { apiKey: process.env.ANTHROPIC_API_KEY || "" }
        );

        logger.log({
          category: "evaluation",
          message: `Validating answer with V3Evaluator (${evaluatorModel})`,
          level: 1,
        });

        const evalResult = await evaluator.ask({
          question: `Did the agent successfully complete this task: "${params.confirmed_task}"?`,
          screenshot: [], // No screenshots available from Agent SDK
          agentReasoning: metrics.reasoning || "No reasoning provided",
        });

        evaluationSuccess = evalResult.evaluation === "YES";
        evaluationReasoning = evalResult.reasoning;

        logger.log({
          category: "evaluation",
          message: `V3Evaluator result: ${evalResult.evaluation} - ${evalResult.reasoning}`,
          level: 1,
        });
      } catch (evalError) {
        logger.log({
          category: "evaluation",
          message: `V3Evaluator error: ${evalError}`,
          level: 0,
        });
        // Fall back to Agent SDK's success determination if evaluator fails
        evaluationSuccess = metrics.success;
        evaluationReasoning = `Evaluator failed: ${evalError}. Fallback to agent result: ${metrics.success}`;
      }
    } else {
      // No reasoning output, mark as failure
      evaluationSuccess = false;
      evaluationReasoning = "No reasoning output from agent";
    }

    return {
      _success: evaluationSuccess,
      agent_completed: metrics.success, // Whether agent finished without hitting limits
      evaluation_result: evaluationSuccess, // Whether LLM judge thinks task was completed
      reasoning: metrics.reasoning,
      evaluation_reasoning: evaluationReasoning,
      error: metrics.error,
      cost_usd: metrics.totalCostUsd,
      input_tokens: metrics.inputTokens,
      output_tokens: metrics.outputTokens,
      duration_ms: metrics.durationMs,
      turn_count: metrics.turnCount,
      skill: params.skill,
      task_level: params.level,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
      agent_messages: metrics.agentMessages, // Full turn-by-turn traces
    };
  } catch (error) {
    logger.log({
      category: "evaluation",
      message: `Error: ${error}`,
      level: 0,
    });

    return {
      _success: false,
      error: String(error),
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  }
};
