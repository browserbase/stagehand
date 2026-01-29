import { EvalFunction } from "../../types/evals";
import { runSkillAgent, SKILL_CONFIGS, getAvailableSkills } from "../../lib/skillAgents";
import dotenv from "dotenv";

dotenv.config();

export const onlineMind2Web_skills_comparison: EvalFunction = async ({
  logger,
  debugUrl,
  sessionUrl,
  input,
}) => {
  const params = input.params as {
    skill: string;
    task: string;
    website: string;
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
    },
  });

  // Return result for Braintrust
  return {
    _success: result.success,
    logs: logger.getLogs(),
    debugUrl: result.browserbaseDebugUrl || debugUrl,
    sessionUrl: result.browserbaseSessionUrl || sessionUrl,
    error: result.error,
  };
};

// Export skill configs for the test suite
export { SKILL_CONFIGS, getAvailableSkills };
