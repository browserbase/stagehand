/**
 * This example shows how to pass custom tools to stagehand agent (both CUA and non-CUA)
 */
import { z } from "zod";
import { tool } from "ai";
import { Stagehand } from "../lib/v3";
import chalk from "chalk";

// Mock weather API, replace with your own API/tool logic
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const fetchWeatherAPI = async (location: string) => {
  return {
    temp: 70,
    conditions: "sunny",
  };
};

// Define the tool in an AI SDK format
const getWeather = tool({
  description: "Get the current weather in a location",
  inputSchema: z.object({
    location: z.string().describe("The location to get weather for"),
  }),
  execute: async ({ location }) => {
    // Your custom logic here
    const weather = await fetchWeatherAPI(location);
    return {
      location,
      temperature: weather.temp,
      conditions: weather.conditions,
    };
  },
});

async function main() {
  console.log(
    `\n${chalk.bold("Stagehand 🤘 Computer Use Agent (CUA) Demo")}\n`,
  );

  // Initialize Stagehand
  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 2,
    experimental: true, // You must enable experimental mode to use custom tools / MCP integrations
    model: "anthropic/claude-sonnet-4-5",
  });
  await stagehand.init();

  try {
    const page = stagehand.context.pages()[0];

    // Create a computer use agent
    const agent = stagehand.agent({
      cua: true,
      model: {
        modelName: "anthropic/claude-sonnet-4-5-20250929",
        apiKey: process.env.ANTHROPIC_API_KEY,
      },
      systemPrompt: `You are a helpful assistant that can use a web browser.
      You are currently on the following page: ${page.url()}.
      Do not ask follow up questions, the user will trust your judgement. Today's date is ${new Date().toLocaleDateString()}.`,
      tools: {
        getWeather, // Pass the tools to the agent
      },
    });

    // const agent = stagehand.agent({
    //   systemPrompt: `You are a helpful assistant that can use a web browser.
    //   You are currently on the following page: ${page.url()}.
    //   Do not ask follow up questions, the user will trust your judgement. Today's date is ${new Date().toLocaleDateString()}.`,
    //   // Pass the tools to the agent
    //   tools: {
    //     getWeather: getWeather,
    //   },
    // });

    // Navigate to the Browserbase careers page
    await page.goto("https://www.google.com");

    // Define the instruction for the CUA
    const instruction = "What's the weather in San Francisco?";
    console.log(`Instruction: ${chalk.white(instruction)}`);

    // Execute the instruction
    const result = await agent.execute({
      instruction,
      maxSteps: 20,
    });

    console.log(`${chalk.green("✓")} Execution complete`);
    console.log(`${chalk.yellow("⤷")} Result:`);
    console.log(chalk.white(JSON.stringify(result, null, 2)));
  } catch (error) {
    console.log(`${chalk.red("✗")} Error: ${error}`);
    if (error instanceof Error && error.stack) {
      console.log(chalk.dim(error.stack.split("\n").slice(1).join("\n")));
    }
  } finally {
    // Close the browser
    await stagehand.close();
  }
}

main().catch((error) => {
  console.log(`${chalk.red("✗")} Unhandled error in main function`);
  console.log(chalk.red(error));
});
