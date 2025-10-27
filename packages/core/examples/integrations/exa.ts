import { Stagehand } from "../../lib/v3";

async function example(stagehand: Stagehand) {
  const page = stagehand.context.pages()[0];
  await page.goto("https://www.google.com");

  const agent = stagehand.agent({
    integrations: [
      `https://mcp.exa.ai/mcp?exaApiKey=${process.env.EXA_API_KEY}`,
    ],
    // Optional: Add custom instructions
    systemPrompt: `You are a helpful assistant that can use a browser as well as external tools such as web search.
    You have access to the Exa search tool to find information on the web.
    When looking for products to buy, make sure to search for current and reliable information.
    Be thorough in your research before making purchase decisions.`,
  });

  const result = await agent.execute(
    "Use one of the tools from Exa to search for the top headphones of 2025. After doing so, use the browser and go through the checkout flow for the best one.",
  );

  console.log(result);
}

(async () => {
  const stagehand = new Stagehand({
    env: "LOCAL",
    model: "openai/gpt-4.1",
    verbose: 1,
    logInferenceToFile: true,
    experimental: true,
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
