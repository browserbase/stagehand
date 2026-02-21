/**
 * Example: Run a Stagehand agent and persist structured logging events to a user-specified dir.
 */
import path from "node:path";
import { Stagehand } from "../lib/v3/index.js";

async function main() {
  const logsRoot = path.resolve(process.cwd(), "examples", "logs");
  process.env.BROWSERBASE_CONFIG_DIR = logsRoot;

  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 1,
  });

  await stagehand.init();

  try {
    const page = stagehand.context.pages()[0];
    await page.goto("https://www.google.com");

    const agent = stagehand.agent();
    await agent.execute({
      instruction:
        "Search for Browserbase and stop after the results are visible.",
      maxSteps: 10,
    });
  } finally {
    // All logs can be found at logs/sessions/$SESSION_ID/session.json, or agent_events.log etc
    await stagehand.close();
  }
}

await main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
