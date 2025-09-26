import { V3 } from "@/lib/v3/v3";

async function main() {
  const v3 = new V3({
    env: "LOCAL",
    verbose: 1,
  });

  await v3.init();

  const startPage = v3.context.pages()[0];
  await startPage.goto(
    "https://browserbase.github.io/stagehand-eval-sites/sites/iframe-hn/",
  );
  const agent = v3.agent({
    model: "claude-sonnet-4-20250514",
    provider: "anthropic",
    options: {
      stashActions: true,
    },
  });

  const result = await agent.execute({
    instruction: "scroll down and click on the last hn story",
    maxSteps: 20,
  });

  console.log(JSON.stringify(result, null, 2));

  console.log(`replaying stashed actions`);
  await startPage.goto(
    "https://browserbase.github.io/stagehand-eval-sites/sites/iframe-hn/",
  );
  const stashedActions = await v3.actionStash();
  await v3.replay(stashedActions);
}

main();
