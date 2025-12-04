import { Stagehand } from "../lib/v3";
import { getSessionFileLogger } from "../lib/v3/flowLogger";

async function run(): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Set OPENAI_API_KEY to a valid OpenAI key before running this demo.",
    );
  }

  // Set custom config dir if desired
  // process.env.BROWSERBASE_CONFIG_DIR = "/tmp/my-stagehand-logs";

  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 2,
    model: { modelName: "openai/gpt-4.1-mini", apiKey },
    localBrowserLaunchOptions: {
      headless: true,
      args: ["--window-size=1280,720"],
    },
    disablePino: true,
  });

  try {
    await stagehand.init();

    // Get the session file logger to see where logs are being written
    const fileLogger = getSessionFileLogger();
    if (fileLogger) {
      console.log("\n🗂️  Session logs are being written to:");
      console.log("   ", fileLogger.getSessionDir());
      console.log("   └── agent_events.log");
      console.log("   └── stagehand_events.log");
      console.log("   └── understudy_events.log");
      console.log("   └── cdp_events.log");
      console.log("   └── session.json\n");
    }

    const [page] = stagehand.context.pages();
    await page.goto("https://example.com/", { waitUntil: "load" });

    const agent = stagehand.agent({
      systemPrompt:
        "You are a QA assistant. Keep answers short and deterministic. Finish quickly.",
    });
    const agentResult = await agent.execute(
      "Glance at the Example Domain page and confirm that you see the hero text.",
    );
    console.log("Agent result:", agentResult);

    const observations = await stagehand.observe(
      "Locate the 'More information...' link on this page.",
    );
    console.log("Observe result:", observations);

    if (observations.length > 0) {
      await stagehand.act(observations[0]);
    } else {
      await stagehand.act("click the link labeled 'More information...'");
    }

    const extraction = await stagehand.extract(
      "Summarize the current page title and URL.",
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
