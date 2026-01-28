#!/usr/bin/env node
/**
 * Test individual providers to verify Browserbase integration
 * Usage: tsx test-individual-provider.ts <provider-name>
 */

import { runSkillAgent, SKILL_CONFIGS } from "./lib/skillAgents";

const providerName = process.argv[2];

if (!providerName || !SKILL_CONFIGS[providerName]) {
  console.error(`Usage: tsx test-individual-provider.ts <provider-name>`);
  console.error(`Available providers: ${Object.keys(SKILL_CONFIGS).join(", ")}`);
  process.exit(1);
}

const instruction = "Open https://example.com and extract the page title";

console.log(`\n${"=".repeat(60)}`);
console.log(`Testing provider: ${providerName}`);
console.log(`Instruction: ${instruction}`);
console.log(`${"=".repeat(60)}\n`);

const startTime = Date.now();

runSkillAgent(instruction, SKILL_CONFIGS[providerName])
  .then((metrics) => {
    const duration = Date.now() - startTime;

    console.log(`\n${"=".repeat(60)}`);
    console.log(`Results for ${providerName}:`);
    console.log(`${"=".repeat(60)}`);
    console.log(`Success: ${metrics.success ? "✅" : "❌"}`);
    console.log(`Duration: ${(duration / 1000).toFixed(1)}s`);
    console.log(`Turns: ${metrics.turnCount}`);
    console.log(`Cost: $${metrics.totalCostUsd.toFixed(3)}`);
    console.log(`Input tokens: ${metrics.inputTokens}`);
    console.log(`Output tokens: ${metrics.outputTokens}`);

    if (metrics.browserbaseSessionId) {
      console.log(`\nBrowserbase Session ID: ${metrics.browserbaseSessionId}`);
    }
    if (metrics.browserbaseSessionUrl) {
      console.log(`Browserbase Session URL: ${metrics.browserbaseSessionUrl}`);
    }

    if (metrics.error) {
      console.log(`\nError: ${metrics.error}`);
    }

    if (metrics.reasoning) {
      console.log(`\nReasoning: ${metrics.reasoning}`);
    }

    console.log(`${"=".repeat(60)}\n`);

    process.exit(metrics.success ? 0 : 1);
  })
  .catch((error) => {
    console.error(`\n❌ Fatal error testing ${providerName}:`);
    console.error(error);
    process.exit(1);
  });
