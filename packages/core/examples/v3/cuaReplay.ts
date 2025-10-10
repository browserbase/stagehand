import { V3 } from "../../lib/v3";

async function main() {
  const v3 = new V3({
    env: "LOCAL",
    verbose: 1,
    cacheDir: "cua-agent-cache",
  });

  await v3.init();

  const startPage = v3.context.pages()[0];
  await startPage.goto(
    "https://browserbase.github.io/stagehand-eval-sites/sites/drag-drop/",
  );
  const agent = v3.agent({
    model: "claude-sonnet-4-20250514",
    provider: "anthropic",
  });

  const result = await agent.execute({
    instruction: "drag 'text' to zone A.",
    maxSteps: 20,
  });

  console.log(JSON.stringify(result, null, 2));
}

main();
