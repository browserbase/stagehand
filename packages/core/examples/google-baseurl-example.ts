import dotenv from "dotenv";
dotenv.config();

import { Stagehand } from "../lib/v3";

/**
 * Example showing how to use a custom baseURL with Google models
 * This allows proxying traffic through a custom server for metrics/testing
 * 
 * Before running this example, start the proxy server:
 *   pnpm tsx examples/google-proxy-server.ts
 * 
 * Both scripts automatically load environment variables from .env file
 */
async function example() {
  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 2,
    model: {
      modelName: "gemini-2.0-flash",
      apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
      // Set a custom baseURL to proxy through your server
      // Make sure the proxy server is running on this port
      baseURL: process.env.PROXY_URL || "http://localhost:8080",
    },
  });

  await stagehand.init();

  const page = stagehand.context.pages()[0];
  await page.goto("https://www.google.com");

  // Use act with the proxied Google model
  await stagehand.act("search for 'Stagehand browser automation'");

  await stagehand.close();
}

// Example with agent (CUA model)
async function agentExample() {
  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 2,
    experimental: true, // Required for custom tools/integrations
  });

  await stagehand.init();

  const page = stagehand.context.pages()[0];
  await page.goto("https://www.google.com");

  const agent = stagehand.agent({
    cua: true,
    model: {
      modelName: "google/gemini-2.5-computer-use-preview-10-2025",
      apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
      // Proxy agent requests through custom server
      // Make sure the proxy server is running on this port
      baseURL: process.env.PROXY_URL || "http://localhost:8080",
    },
  });

  const result = await agent.execute({
    instruction: "Search for Stagehand browser automation",
    maxSteps: 10,
  });

  console.log(result.message);

  await stagehand.close();
}

// Run the example if this file is executed directly
if (require.main === module) {
  agentExample().catch(console.error);
}

export { example, agentExample };

