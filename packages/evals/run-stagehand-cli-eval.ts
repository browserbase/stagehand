import { buildOnlineMind2WebSkillsTestcases } from "./suites/onlineMind2Web-skills";
import { onlineMind2Web_skills_comparison } from "./tasks/agent/onlineMind2Web_skills_comparison";
import { EvalLogger } from "./logger";

async function main() {
  // Build testcases for just stagehand-cli, limit to 5
  process.env.EVAL_MAX_K = "5";
  const testcases = buildOnlineMind2WebSkillsTestcases(["stagehand-cli"]);

  console.log(`Running ${testcases.length} testcases for stagehand-cli\n`);

  const results = [];

  for (const testcase of testcases) {
    const logger = new EvalLogger();

    console.log(`\n${"=".repeat(80)}`);
    console.log(`Task ${testcase.metadata.task_id}: ${testcase.input.params.confirmed_task}`);
    console.log(`Website: ${testcase.input.params.website}`);
    console.log(`${"=".repeat(80)}\n`);

    const startTime = Date.now();
    const result = await onlineMind2Web_skills_comparison({
      logger,
      debugUrl: "",
      sessionUrl: "",
      input: testcase.input,
    });

    const duration = Date.now() - startTime;

    results.push({
      task_id: testcase.metadata.task_id,
      success: result._success,
      turn_count: result.turn_count,
      duration_ms: result.duration_ms || duration,
      cost_usd: result.cost_usd,
    });

    console.log(`\n${"=".repeat(80)}`);
    console.log(`Task Complete: ${result._success ? "✅ SUCCESS" : "❌ FAILED"}`);
    console.log(`Turns: ${result.turn_count}`);
    console.log(`Duration: ${((result.duration_ms || duration) / 1000).toFixed(1)}s`);
    console.log(`Cost: $${(result.cost_usd || 0).toFixed(2)}`);
    if (result.error) {
      console.log(`Error: ${result.error}`);
    }
    console.log(`${"=".repeat(80)}\n`);
  }

  // Summary
  const successCount = results.filter(r => r.success).length;
  const avgTurns = results.reduce((sum, r) => sum + (r.turn_count || 0), 0) / results.length;
  const avgDuration = results.reduce((sum, r) => sum + r.duration_ms, 0) / results.length;
  const avgCost = results.reduce((sum, r) => sum + (r.cost_usd || 0), 0) / results.length;

  console.log(`\n${"=".repeat(80)}`);
  console.log("EVALUATION COMPLETE");
  console.log(`${"=".repeat(80)}`);
  console.log(`Total tasks: ${results.length}`);
  console.log(`Successful: ${successCount} (${(successCount / results.length * 100).toFixed(1)}%)`);
  console.log(`Avg turns: ${avgTurns.toFixed(1)}`);
  console.log(`Avg duration: ${(avgDuration / 1000).toFixed(1)}s`);
  console.log(`Avg cost: $${avgCost.toFixed(2)}`);
  console.log(`${"=".repeat(80)}\n`);

  // Individual results
  console.log("Individual Results:");
  results.forEach((r, i) => {
    console.log(`${i + 1}. ${r.success ? "✅" : "❌"} ${r.task_id} - ${r.turn_count} turns, ${(r.duration_ms / 1000).toFixed(1)}s, $${(r.cost_usd || 0).toFixed(2)}`);
  });
}

main().catch(console.error);
