import { Stagehand } from "../lib/v3";

async function run(): Promise<void> {
  const openaiKey = process.env.OPENAI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (!openaiKey || !anthropicKey) {
    throw new Error(
      "Set both OPENAI_API_KEY and ANTHROPIC_API_KEY before running this demo.",
    );
  }

  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 2,
    model: { modelName: "openai/gpt-4.1-mini", apiKey: openaiKey },
    localBrowserLaunchOptions: {
      headless: true,
      args: ["--window-size=1280,720"],
    },
    disablePino: true,
  });

  try {
    await stagehand.init();

    const [page] = stagehand.context.pages();
    await page.goto("https://example.com/", { waitUntil: "load" });

    // Test standard agent path
    const agent = stagehand.agent({
      systemPrompt:
        "You are a QA assistant. Keep answers short and deterministic. Finish quickly.",
    });
    const agentResult = await agent.execute(
      "Glance at the Example Domain page and confirm that you see the hero text.",
    );
    console.log("Agent result:", agentResult);

    // Test CUA (Computer Use Agent) path
    await page.goto("https://example.com/", { waitUntil: "load" });
    const cuaAgent = stagehand.agent({
      cua: true,
      model: {
        modelName: "anthropic/claude-sonnet-4-5-20250929",
        apiKey: anthropicKey,
      },
    });
    const cuaResult = await cuaAgent.execute({
      instruction: "Click on the 'More information...' link on the page.",
      maxSteps: 3,
    });
    console.log("CUA Agent result:", cuaResult);

    const observations = await stagehand.observe("Find any links on the page");
    console.log("Observe result:", observations);

    if (observations.length > 0) {
      await stagehand.act(observations[0]);
    } else {
      await stagehand.act("click the link on the page");
    }

    const extraction = await stagehand.extract(
      "Summarize the current page title and contents in a single sentence",
    );
    console.log("Extraction result:", extraction);
  } finally {
    await stagehand.close({ force: true }).catch(() => {});
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
