/**
 * Parallel eval for all tools using LOCAL browsers
 * Runs all 6 tools in parallel, each tool runs its 5 tasks sequentially
 * Much faster than running tools sequentially!
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
  console.log(`\n[${toolName}] Starting evaluation...`);

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
    if (!SKILL_CONFIGS[toolName]) {
      throw new Error(`Tool "${toolName}" not found in SKILL_CONFIGS`);
    }

    process.env.EVAL_MAX_K = "5";
    const testcases = buildOnlineMind2WebSkillsTestcases([toolName]);

    if (testcases.length === 0) {
      throw new Error(`No testcases generated for ${toolName}`);
    }

    result.total_tasks = testcases.length;

    // Run tasks sequentially for this tool (to avoid browser conflicts)
    for (let i = 0; i < testcases.length; i++) {
      const testcase = testcases[i];
      const taskNum = i + 1;

      console.log(`[${toolName}] Task ${taskNum}/${testcases.length}: ${testcase.input.params.confirmed_task.substring(0, 60)}...`);

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

        console.log(`[${toolName}] Task ${taskNum} ${taskResult._success ? "✅" : "❌"}: ${taskResult.turn_count || 0} turns, ${duration_s.toFixed(1)}s, $${(taskResult.cost_usd || 0).toFixed(4)}, ${total_task_tokens.toLocaleString()} tokens\n`);

      } catch (error) {
        console.log(`[${toolName}] Task ${taskNum} ❌ EXCEPTION: ${error}\n`);
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

    // Calculate aggregates
    result.success_rate = (result.successful_tasks / result.total_tasks) * 100;
    result.avg_turns = result.tasks.reduce((sum, t) => sum + t.turns, 0) / result.total_tasks;
    result.avg_duration_s = result.tasks.reduce((sum, t) => sum + t.duration_s, 0) / result.total_tasks;
    result.avg_cost = result.tasks.reduce((sum, t) => sum + t.cost, 0) / result.total_tasks;
    result.total_tokens = result.total_input_tokens + result.total_output_tokens;
    result.avg_tokens_per_task = result.total_tokens / result.total_tasks;

    console.log(`\n[${toolName}] ===== COMPLETE =====`);
    console.log(`[${toolName}] Success: ${result.successful_tasks}/${result.total_tasks} (${result.success_rate.toFixed(1)}%)`);
    console.log(`[${toolName}] Avg: ${result.avg_turns.toFixed(1)} turns, ${result.avg_duration_s.toFixed(1)}s, $${result.avg_cost.toFixed(4)}, ${result.avg_tokens_per_task.toFixed(0)} tokens/task`);
    console.log(`[${toolName}] Total: ${result.total_tokens.toLocaleString()} tokens\n`);

  } catch (error) {
    console.error(`\n[${toolName}] ===== FAILED: ${error} =====\n`);
    result.error = String(error);
  }

  return result;
}

async function main() {
  console.log("\n" + "=".repeat(120));
  console.log("PARALLEL BROWSER AUTOMATION EVAL - LOCAL BROWSERS");
  console.log("=".repeat(120));

  const tools = Object.keys(SKILL_CONFIGS);
  console.log(`Testing ${tools.length} tools: ${tools.join(", ")}`);
  console.log(`Tasks per tool: 5 (n=5)`);
  console.log(`Total tasks: 30`);
  console.log(`Mode: Tools run in PARALLEL (6 concurrent tools), tasks within each tool run sequentially`);
  console.log(`Model: claude-opus-4-5-20251101`);
  console.log("=".repeat(120) + "\n");

  const startTime = Date.now();

  // Run ALL tools in parallel
  console.log("🚀 Starting parallel execution of all 6 tools...\n");
  const toolPromises = tools.map(tool => testTool(tool));
  const results = await Promise.all(toolPromises);

  const totalDuration = (Date.now() - startTime) / 1000;

  // Final comparison table
  console.log("\n\n" + "=".repeat(120));
  console.log("FINAL COMPARISON TABLE");
  console.log("=".repeat(120));
  console.log(`Total wall-clock time: ${(totalDuration / 60).toFixed(1)} minutes (parallel) vs ~${(tools.length * 10).toFixed(0)} minutes (sequential)\n`);

  const sortedResults = [...results].sort((a, b) => b.success_rate - a.success_rate);

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
  console.log(`Wall-clock time: ${(totalDuration / 60).toFixed(1)} minutes (${tools.length}x faster than sequential)`);

  console.log("\n" + "=".repeat(120));
  console.log("EVALUATION COMPLETE - Results on axes: success rate, tokens, time, cost");
  console.log("=".repeat(120) + "\n");

  console.log("\nDetailed Results JSON:");
  console.log(JSON.stringify(results, null, 2));
}

main().catch(console.error);
