/**
 * Example implementation of Stagehand using Ollama for local LLM processing
 * 
 * This example demonstrates how to:
 * 1. Set up Stagehand with Ollama as the LLM client
 * 2. Extract structured data from a webpage using a local LLM
 * 
 * Usage:
 * Option 1: In main.ts (created by npx create-browser-app)
 * - Copy this code and rename example() to main()
 * 
 * Option 2: In index.ts
 * - Import the example function:
 *   import { example } from "./external_client.ts"
 * - Call it:
 *   await example()
 */

import { Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod";
import { OllamaClient } from "./ollama_client.js";
import StagehandConfig from "./stagehand.config.js";

export async function example() {
    const stagehand = new Stagehand({
        ...StagehandConfig,
        llmClient: new OllamaClient({
            modelName: "llama3.2", // Change this to any Ollama model of your choice 
        }),
    });

    await stagehand.init();
    await stagehand.page.goto("https://news.ycombinator.com");

    const headlines = await stagehand.page.extract({
        instruction: "Extract only 3 stories from the Hacker News homepage.",
        schema: z.object({
            stories: z
                .array(
                    z.object({
                        title: z.string(),
                        url: z.string(),
                        points: z.number(),
                    }),
                )
                .length(3),
        }),
    });

    console.log(headlines);
    await stagehand.close();
}

(async () => {
    await example();
})();