import { V3 } from "../../lib/v3";
import { v3Logger } from "../../lib/v3/logger";
import dotenv from "dotenv";

dotenv.config();

async function runDemo(runNumber: number) {
  const startTime = Date.now();

  v3Logger({
    level: 1,
    category: "demo",
    message: `RUN ${runNumber}: ${runNumber === 1 ? "BUILDING CACHE" : "USING CACHE"}`,
  });

  const v3 = new V3({
    env: "LOCAL",
    verbose: 1,
    cacheDir: "cua-agent-cache",
  });

  await v3.init();

  const page = v3.context.pages()[0];

  await page.goto("https://v0-modern-login-flow.vercel.app/", {
    waitUntil: "networkidle",
  });

  const agent = v3.agent({
    cua: true,
    model: "anthropic/claude-sonnet-4-20250514",
  });

  const result = await agent.execute({
    instruction: `Sign in with the email address 'test@browserbaser.com' and the password 'stagehand=goated'`,
    maxSteps: 20,
  });

  const endTime = Date.now();
  const duration = (endTime - startTime) / 1000;

  await v3.context.close();

  return {
    duration,
    success: result.success,
    result,
  };
}

async function main() {
  const metrics1 = await runDemo(1);

  v3Logger({
    level: 1,
    category: "demo",
    message: "⏳ Waiting 2 seconds before cached run...",
  });
  await new Promise((resolve) => setTimeout(resolve, 2000));

  v3Logger({
    level: 1,
    category: "demo",
    message: "Starting second run with cache...",
  });
  const metrics2 = await runDemo(2);

  const duration1 = `${metrics1.duration.toFixed(2)}s`;
  const duration2 = `${metrics2.duration.toFixed(2)}s`;

  v3Logger({
    level: 1,
    category: "demo",
    message: `
╔════════════════════════════════════════════════════════════╗
║                  📊 PERFORMANCE COMPARISON                 ║
╚════════════════════════════════════════════════════════════╝

┌─────────────────────┬──────────────────┬──────────────────┐
│     Metric          │   Run 1 (Cold)   │  Run 2 (Cached)  │
├─────────────────────┼──────────────────┼──────────────────┤
│ Duration            │ ${duration1.padEnd(16)} │ ${duration2.padEnd(16)} │
└─────────────────────┴──────────────────┴──────────────────┘

 Performance Comparison:
   • Speed: ${((1 - metrics2.duration / metrics1.duration) * 100).toFixed(1)}% faster with cache
   • Time saved: ${(metrics1.duration - metrics2.duration).toFixed(2)} seconds

 Insights:
   • First run establishes the CUA action cache
   • Second run reuses cached actions for instant execution
   • Zero LLM tokens used on cached run`,
  });
}

main().catch(console.error);
