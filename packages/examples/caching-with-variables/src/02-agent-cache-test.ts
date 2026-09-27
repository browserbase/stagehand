/**
 * Demo 2: Stagehand Agent Caching Test
 *
 * This demo tests whether Stagehand's agent() API uses caching.
 *
 * Key findings from code analysis:
 * - YES, Agent does have caching support (AgentCache.ts)
 * - Agent cache stores: instruction, startUrl, options, configSignature, steps, result
 * - Cache key = hash(instruction + startUrl + options + configSignature)
 * - Agent does NOT currently support variables like act() does
 *
 * This demo:
 * 1. Tests agent caching with a simple task
 * 2. Runs the same task twice to observe cache behavior
 * 3. Compares performance between first and second runs
 *
 * Future: Test agent with variables (if/when supported)
 */

import { Stagehand } from "@browserbasehq/stagehand";
import * as fs from "fs";
import * as path from "path";
import "dotenv/config";

const CACHE_DIR = path.join(process.cwd(), ".cache", "agent-cache");

interface RunResult {
  runNumber: number;
  elapsed: number;
  stepCount: number;
  success: boolean;
  cacheHit: boolean;
}

async function runAgentTask(runNumber: number): Promise<RunResult> {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`AGENT RUN ${runNumber}`);
  console.log("=".repeat(60));

  const startTime = Date.now();

  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 1,
    model: "gpt-4o-mini",
    cacheDir: CACHE_DIR,
  });

  await stagehand.init();
  const page = stagehand.context.pages()[0];

  try {
    // Check if cache exists before this run
    const cacheExistedBefore =
      fs.existsSync(CACHE_DIR) &&
      fs.readdirSync(CACHE_DIR).filter((f) => f.startsWith("agent-")).length > 0;

    console.log(`\nCache before run: ${cacheExistedBefore ? "EXISTS" : "EMPTY"}`);

    // Navigate to a simple page
    console.log("\nNavigating to demo page...");
    await page.goto("https://the-internet.herokuapp.com/");
    await page.waitForLoadState("domcontentloaded");

    // Create agent and execute a simple task
    console.log("\nCreating agent...");
    const agent = stagehand.agent({
      model: "gpt-4o", // Agent requires a capable model
    });

    console.log("\nExecuting agent task...");
    console.log(`  Instruction: "Click on the 'Form Authentication' link"`);

    const agentStartTime = Date.now();

    const result = await agent.execute({
      instruction: "Click on the 'Form Authentication' link",
      maxSteps: 5,
    });

    const agentElapsed = Date.now() - agentStartTime;

    // Determine if this was a cache hit based on timing and metadata
    const cacheHit = (result as any).metadata?.cacheHit === true || agentElapsed < 1000;

    console.log(`\nAgent completed in ${agentElapsed}ms`);
    console.log(`Success: ${result.success}`);
    console.log(`Message: ${result.message}`);
    console.log(`Steps: ${result.actions?.length ?? 0}`);
    console.log(`Cache: ${cacheHit ? "HIT" : "MISS"}`);

    if ((result as any).metadata?.cacheHit) {
      console.log(`Cache Timestamp: ${(result as any).metadata?.cacheTimestamp}`);
    }

    const elapsed = Date.now() - startTime;

    await stagehand.close();

    return {
      runNumber,
      elapsed,
      stepCount: result.actions?.length ?? 0,
      success: result.success,
      cacheHit,
    };
  } catch (error) {
    console.error("Error:", error);
    await stagehand.close();
    throw error;
  }
}

async function inspectAgentCache() {
  console.log(`\n${"=".repeat(60)}`);
  console.log("AGENT CACHE INSPECTION");
  console.log("=".repeat(60));

  if (!fs.existsSync(CACHE_DIR)) {
    console.log("\nNo cache directory found.");
    return;
  }

  const cacheFiles = fs.readdirSync(CACHE_DIR).filter((f) => f.startsWith("agent-"));
  console.log(`\nFound ${cacheFiles.length} agent cache file(s):`);

  for (const file of cacheFiles) {
    const filePath = path.join(CACHE_DIR, file);
    const content = JSON.parse(fs.readFileSync(filePath, "utf-8"));

    console.log(`\n--- ${file} ---`);
    console.log(`  Version: ${content.version}`);
    console.log(`  Instruction: "${content.instruction}"`);
    console.log(`  Start URL: ${content.startUrl}`);
    console.log(`  Options: ${JSON.stringify(content.options)}`);
    console.log(`  Steps: ${content.steps?.length ?? 0} step(s)`);
    console.log(`  Timestamp: ${content.timestamp}`);

    // Show step types
    if (content.steps && content.steps.length > 0) {
      console.log(`  Step Types:`);
      for (const step of content.steps) {
        console.log(`    - ${step.type}${step.instruction ? `: "${step.instruction}"` : ""}`);
      }
    }

    // Show result summary
    if (content.result) {
      console.log(`  Result:`);
      console.log(`    Success: ${content.result.success}`);
      console.log(`    Message: ${content.result.message}`);
      console.log(`    Actions: ${content.result.actions?.length ?? 0}`);
    }
  }
}

async function main() {
  console.log(`
${"#".repeat(60)}
#  Stagehand Agent Caching Test Demo
#
#  Tests whether agent() uses caching:
#  - Run 1: Expected cache MISS (first execution)
#  - Run 2: Expected cache HIT (replay from cache)
${"#".repeat(60)}
`);

  // Clear cache for fresh demo
  const args = process.argv.slice(2);
  if (args.includes("--fresh")) {
    console.log("Clearing cache for fresh run...");
    if (fs.existsSync(CACHE_DIR)) {
      fs.rmSync(CACHE_DIR, { recursive: true });
    }
  }

  const results: RunResult[] = [];

  // Run 1: First execution - should be cache MISS
  console.log("\n\n>>> PHASE 1: First agent run (expect cache MISS)");
  results.push(await runAgentTask(1));

  // Wait a moment between runs
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Run 2: Same task again - should be cache HIT
  console.log("\n\n>>> PHASE 2: Second agent run (expect cache HIT)");
  results.push(await runAgentTask(2));

  // Inspect cache contents
  await inspectAgentCache();

  // Summary
  console.log(`\n${"=".repeat(60)}`);
  console.log("RESULTS SUMMARY");
  console.log("=".repeat(60));

  console.log("\n| Run | Time (ms) | Steps | Success | Cache  |");
  console.log("|-----|-----------|-------|---------|--------|");

  for (const r of results) {
    const timeDisplay = r.elapsed.toString().padStart(9);
    const stepsDisplay = r.stepCount.toString().padStart(5);
    const successDisplay = r.success ? "Yes" : "No ";
    const cacheDisplay = r.cacheHit ? "HIT " : "MISS";
    console.log(
      `|  ${r.runNumber}  | ${timeDisplay} | ${stepsDisplay} | ${successDisplay}     | ${cacheDisplay}   |`,
    );
  }

  if (results.length >= 2) {
    const speedup = (results[0].elapsed / results[1].elapsed).toFixed(1);
    console.log(`\nPerformance improvement: ${speedup}x faster with cache`);
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log("KEY FINDINGS");
  console.log("=".repeat(60));

  const agentCacheExists =
    fs.existsSync(CACHE_DIR) &&
    fs.readdirSync(CACHE_DIR).filter((f) => f.startsWith("agent-")).length > 0;

  console.log(`
1. AGENT CACHING STATUS:
   - Cache files created: ${agentCacheExists ? "YES" : "NO"}
   - Second run faster: ${results.length >= 2 ? (results[1].elapsed < results[0].elapsed ? "YES" : "NO") : "N/A"}

2. HOW AGENT CACHE WORKS:
   - Cache key = hash(instruction + startUrl + options + configSignature)
   - Stores: steps (act, goto, scroll, etc.) + final result
   - On replay: executes cached steps without LLM calls

3. CURRENT LIMITATIONS:
   - Agent does NOT support variables like act() does
   - Cannot use %placeholder% syntax in agent instructions
   - Variable data in agent instructions is stored in cache

4. FUTURE CONSIDERATION:
   - Agent with variables would need similar mechanism to act()
   - Would need to strip variable values from cached steps
   - Would need to inject values during replay
`);

  console.log(`\n${"=".repeat(60)}`);
  console.log("COMPARISON: ACT vs AGENT CACHING");
  console.log("=".repeat(60));

  console.log(`
| Feature                    | act() Cache | agent() Cache |
|----------------------------|-------------|---------------|
| Caching supported          | Yes         | Yes           |
| Variables supported        | Yes         | No            |
| Privacy preservation       | Yes         | No            |
| Cache key based on         | instr+url+  | instr+url+    |
|                            | varKeys     | options+config|
| Replays actions            | Yes         | Yes           |
| Multi-step workflows       | Single act  | Full workflow |
`);

  console.log(`\n${"=".repeat(60)}`);
  console.log("TRY IT YOURSELF");
  console.log("=".repeat(60));

  console.log(`
1. Run again (cache will be hit):
   npm run demo:agent-cache

2. Run with fresh cache:
   npm run demo:agent-cache -- --fresh

3. Clear cache manually:
   npm run clear-cache

4. Inspect cache contents:
   cat .cache/agent-cache/agent-*.json | jq .
`);
}

main().catch(console.error);
