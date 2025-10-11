import { connectToMCPServer, Stagehand } from "../../lib/v3";

async function example(stagehand: Stagehand) {
  const page = stagehand.context.pages()[0];
  await page.goto("https://www.opentable.com/");

  const supabaseClient = await connectToMCPServer(
    `https://server.smithery.ai/@supabase-community/supabase-mcp/mcp?api_key=${process.env.SMITHERY_API_KEY}`,
  );

  const agent = stagehand.agent({
    model: "openai/computer-use-preview",
    integrations: [supabaseClient],
  });

  const result = await agent.execute(
    "Search for restaurants in New Brunswick, NJ. Then, use the Supabase tools to insert the name of the first result of the search into a table called 'restaurants'.",
  );

  console.log(result);
}

(async () => {
  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 1,
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
