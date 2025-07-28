import { Stagehand } from "@browserbasehq/stagehand";
import dotenv from "dotenv";
import path from "path";

// Load environment variables
dotenv.config({ path: path.join(__dirname, "../.env") });

async function runMultiProviderExample() {
  console.log("=== AI SDK Multi-Provider Example ===\n");

  const stagehand = new Stagehand({
    env: "LOCAL",
    experimental: true,
  });

  try {
    await stagehand.init();
    console.log("Stagehand initialized successfully\n");

    await stagehand.page.goto("https://example.com", { timeout: 60000 });

    // Test with different providers
    const providers = [
      {
        name: "Anthropic",
        model: "anthropic/claude-3-5-sonnet-20241022",
        apiKey: process.env.ANTHROPIC_API_KEY,
      },
      {
        name: "OpenAI",
        model: "openai/gpt-4o-mini",
        apiKey: process.env.OPENAI_API_KEY,
      },
      {
        name: "Google",
        model: "google/gemini-1.5-flash",
        apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
      },
    ];

    for (const provider of providers) {
      if (!provider.apiKey) {
        console.log(`⚠️  Skipping ${provider.name} - API key not found\n`);
        continue;
      }

      console.log(`\n🤖 Testing with ${provider.name} (${provider.model})`);
      console.log("─".repeat(50));

      const agent = stagehand.agent({
        provider: "aisdk",
        model: provider.model,
        options: {
          apiKey: provider.apiKey,
        },
      });

      const { text } = await agent.execute({
        instruction: "What is the main heading on this page?",
        maxSteps: 3,
        onTextDelta: (delta) => {
          process.stdout.write(delta);
        },
      });

      const finalText = await text;
      console.log(`\n\nProvider: ${provider.name}`);
      console.log(`Response: ${finalText}`);
      console.log("─".repeat(50));
    }
  } catch (error) {
    console.error("\n❌ Error:", error);
  } finally {
    await stagehand.close();
    console.log("\n\nStagehand closed");
  }
}

if (require.main === module) {
  runMultiProviderExample().catch(console.error);
}
