import { EvalFunction } from "../../types/evals";
import { runSkillAgent, SKILL_CONFIGS } from "../../lib/skillAgents";

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

Use "stagehand execute" to batch operations. At the end, produce: "Final Answer: <answer>"`;

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

    const taskSuccess = metrics.success && metrics.reasoning && !metrics.error;

    return {
      _success: taskSuccess,
      reasoning: metrics.reasoning,
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
