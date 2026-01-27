/**
 * Comprehensive eval for all browser automation tools
 * Tests each tool with n=5 tasks, verifies no broken configs/auth/browser
 * Reports: token usage, time, success rate, cost
 */

import { buildOnlineMind2WebSkillsTestcases } from "./suites/onlineMind2Web-skills";
import { onlineMind2Web_skills_comparison } from "./tasks/agent/onlineMind2Web_skills_comparison";
import { EvalLogger } from "./logger";
import { SKILL_CONFIGS } from "./lib/skillAgents";

interface ToolResult {
  tool: string;
  total_tasks: number;
  successful_tasks: number;
  success_rate: number;
  avg_turns: number;
  avg_duration_s: number;
  avg_cost: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_tokens: number;
  avg_tokens_per_task: number;
  tasks: Array<{
    task_id: string;
    success: boolean;
    turns: number;
    duration_s: number;
    cost: number;
    tokens: number;
    error?: string;
  }>;
  error?: string;
}

async function testTool(toolName: string): Promise<ToolResult> {
  console.log(`\n${"=".repeat(100)}`);
  console.log(`TESTING: ${toolName.toUpperCase()}`);
  console.log(`${"=".repeat(100)}\n`);

  const result: ToolResult = {
    tool: toolName,
    total_tasks: 0,
    successful_tasks: 0,
    success_rate: 0,
    avg_turns: 0,
    avg_duration_s: 0,
    avg_cost: 0,
    total_input_tokens: 0,
    total_output_tokens: 0,
    total_tokens: 0,
    avg_tokens_per_task: 0,
    tasks: [],
  };

  try {
    // Verify tool config exists
    if (!SKILL_CONFIGS[toolName]) {
      throw new Error(`Tool "${toolName}" not found in SKILL_CONFIGS`);
    }


    // Generate testcases for this tool only
    process.env.EVAL_MAX_K = "5";
    const testcases = buildOnlineMind2WebSkillsTestcases([toolName]);

    if (testcases.length === 0) {
      throw new Error(`No testcases generated for ${toolName}`);
    }

    result.total_tasks = testcases.length;

    // Run each testcase
    for (let i = 0; i < testcases.length; i++) {
      const testcase = testcases[i];
      const taskNum = i + 1;

      console.log(`\n${"-".repeat(80)}`);
      console.log(`[${taskNum}/${testcases.length}] Task: ${testcase.metadata.task_id.substring(0, 12)}...`);
      console.log(`  ${testcase.input.params.confirmed_task.substring(0, 80)}...`);
      console.log(`  Difficulty: ${testcase.metadata.difficulty}, Website: ${testcase.metadata.website}`);
      console.log(`${"-".repeat(80)}`);

      const logger = new EvalLogger();
      const startTime = Date.now();

      try {
        const taskResult = await onlineMind2Web_skills_comparison({
          logger,
          debugUrl: "",
          sessionUrl: "",
          input: testcase.input,
        });

        const duration_ms = taskResult.duration_ms || (Date.now() - startTime);
        const duration_s = duration_ms / 1000;
        const input_tokens = taskResult.input_tokens || 0;
        const output_tokens = taskResult.output_tokens || 0;
        const total_task_tokens = input_tokens + output_tokens;

        result.tasks.push({
          task_id: testcase.metadata.task_id,
          success: taskResult._success,
          turns: taskResult.turn_count || 0,
          duration_s,
          cost: taskResult.cost_usd || 0,
          tokens: total_task_tokens,
          error: taskResult.error,
        });

        if (taskResult._success) {
          result.successful_tasks++;
        }

        result.total_input_tokens += input_tokens;
        result.total_output_tokens += output_tokens;

        console.log(`\n  Result: ${taskResult._success ? "✅ SUCCESS" : "❌ FAILED"}`);
        console.log(`  Turns: ${taskResult.turn_count || 0}`);
        console.log(`  Duration: ${duration_s.toFixed(1)}s`);
        console.log(`  Cost: $${(taskResult.cost_usd || 0).toFixed(4)}`);
        console.log(`  Tokens: ${input_tokens.toLocaleString()} in + ${output_tokens.toLocaleString()} out = ${total_task_tokens.toLocaleString()} total`);
        if (taskResult.error) {
          console.log(`  Error: ${taskResult.error.substring(0, 100)}...`);
        }

      } catch (error) {
        console.log(`\n  Result: ❌ EXCEPTION`);
        console.log(`  Error: ${error}`);

        result.tasks.push({
          task_id: testcase.metadata.task_id,
          success: false,
          turns: 0,
          duration_s: (Date.now() - startTime) / 1000,
          cost: 0,
          tokens: 0,
          error: String(error),
        });
      }
    }

    // Calculate averages
    result.success_rate = (result.successful_tasks / result.total_tasks) * 100;
    result.avg_turns = result.tasks.reduce((sum, t) => sum + t.turns, 0) / result.total_tasks;
    result.avg_duration_s = result.tasks.reduce((sum, t) => sum + t.duration_s, 0) / result.total_tasks;
    result.avg_cost = result.tasks.reduce((sum, t) => sum + t.cost, 0) / result.total_tasks;
    result.total_tokens = result.total_input_tokens + result.total_output_tokens;
    result.avg_tokens_per_task = result.total_tokens / result.total_tasks;

    console.log(`\n${"=".repeat(100)}`);
    console.log(`${toolName.toUpperCase()} COMPLETE`);
    console.log(`${"=".repeat(100)}`);
    console.log(`Success: ${result.successful_tasks}/${result.total_tasks} (${result.success_rate.toFixed(1)}%)`);
    console.log(`Avg Turns: ${result.avg_turns.toFixed(1)}`);
    console.log(`Avg Duration: ${result.avg_duration_s.toFixed(1)}s`);
    console.log(`Avg Cost: $${result.avg_cost.toFixed(4)}`);
    console.log(`Total Tokens: ${result.total_tokens.toLocaleString()} (${result.total_input_tokens.toLocaleString()} in + ${result.total_output_tokens.toLocaleString()} out)`);
    console.log(`Avg Tokens/Task: ${result.avg_tokens_per_task.toFixed(0)}`);
    console.log(`${"=".repeat(100)}\n`);

  } catch (error) {
    console.error(`\n❌ FAILED TO TEST ${toolName}: ${error}\n`);
    result.error = String(error);
  }

  return result;
}

async function main() {
  const tools = Object.keys(SKILL_CONFIGS);

  console.log("\n" + "=".repeat(100));
  console.log("COMPREHENSIVE BROWSER AUTOMATION TOOLS EVALUATION");
  console.log("=".repeat(100));
  console.log(`Testing ${tools.length} tools: ${tools.join(", ")}`);
  console.log(`Tasks per tool: 5 (n=5)`);
  console.log(`Model: claude-opus-4-5-20251101`);
  console.log("=".repeat(100) + "\n");

  const results: ToolResult[] = [];

  for (const tool of tools) {
    const result = await testTool(tool);
    results.push(result);

    // Brief pause between tools
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  // Final comparison table
  console.log("\n\n" + "=".repeat(120));
  console.log("FINAL COMPARISON TABLE");
  console.log("=".repeat(120));
  console.log();

  // Sort by success rate descending
  const sortedResults = [...results].sort((a, b) => b.success_rate - a.success_rate);

  // Print header
  console.log("Rank | Tool              | Success | Turns | Time(s) | Cost($) | Tokens/Task | Total Tokens");
  console.log("-----|-------------------|---------|-------|---------|---------|-------------|-------------");

  sortedResults.forEach((r, i) => {
    const rank = `${i + 1}.`;
    const tool = r.tool.padEnd(17);
    const success = `${r.successful_tasks}/${r.total_tasks} ${r.success_rate.toFixed(0)}%`.padEnd(7);
    const turns = r.avg_turns.toFixed(1).padStart(5);
    const time = r.avg_duration_s.toFixed(1).padStart(7);
    const cost = r.avg_cost.toFixed(4).padStart(7);
    const tokensPerTask = Math.round(r.avg_tokens_per_task).toLocaleString().padStart(11);
    const totalTokens = r.total_tokens.toLocaleString().padStart(12);

    console.log(`${rank.padStart(4)} | ${tool} | ${success} | ${turns} | ${time} | ${cost} | ${tokensPerTask} | ${totalTokens}`);
  });

  console.log("=".repeat(120));
  console.log();

  // Key findings
  console.log("\nKEY FINDINGS:");
  console.log("-".repeat(80));

  const best = sortedResults[0];
  const byDuration = [...sortedResults].sort((a, b) => a.avg_duration_s - b.avg_duration_s);
  const byCost = [...sortedResults].sort((a, b) => a.avg_cost - b.avg_cost);
  const byTokens = [...sortedResults].sort((a, b) => a.avg_tokens_per_task - b.avg_tokens_per_task);
  const byTurns = [...sortedResults].sort((a, b) => a.avg_turns - b.avg_turns);

  console.log(`Best success rate: ${best.tool} (${best.success_rate.toFixed(1)}%)`);
  console.log(`Fastest: ${byDuration[0].tool} (${byDuration[0].avg_duration_s.toFixed(1)}s avg)`);
  console.log(`Cheapest: ${byCost[0].tool} ($${byCost[0].avg_cost.toFixed(4)} avg)`);
  console.log(`Fewest tokens: ${byTokens[0].tool} (${byTokens[0].avg_tokens_per_task.toFixed(0)} avg)`);
  console.log(`Fewest turns: ${byTurns[0].tool} (${byTurns[0].avg_turns.toFixed(1)} avg)`);

  console.log("\n" + "=".repeat(120));
  console.log("EVALUATION COMPLETE");
  console.log("=".repeat(120) + "\n");

  // Export detailed JSON
  console.log("\nDetailed Results JSON:");
  console.log(JSON.stringify(results, null, 2));
}

main().catch(console.error);
