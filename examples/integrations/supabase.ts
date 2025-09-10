import StagehandConfig from "@/stagehand.config";
import { connectToMCPServer, Stagehand } from "@browserbasehq/stagehand";

async function example(stagehand: Stagehand) {
  const page = stagehand.page;
  await page.goto("https://www.opentable.com/");

  const supabaseClient = await connectToMCPServer(
    `https://server.smithery.ai/@supabase-community/supabase-mcp/mcp?api_key=${process.env.SMITHERY_API_KEY}`,
  );

  const agent = stagehand.agent({
    provider: "openai",
    model: "computer-use-preview",
    integrations: [supabaseClient],
  });

  const result = await agent.execute(
    "Search for restaurants in New Brunswick, NJ. Then, use the Supabase tools to insert the name of the first result of the search into a table called 'restaurants'.",
  );

  console.log(result);
}

(async () => {
  const stagehand = new Stagehand({
    ...StagehandConfig,
    env: "LOCAL",
  });

  try {
    await stagehand.init();
    await example(stagehand);
  } catch (error) {
    console.error("Error running example:", error);
  } finally {
    await stagehand.close();
  }
})();
