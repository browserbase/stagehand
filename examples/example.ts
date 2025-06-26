/**
 * This file is meant to be used as a scratchpad for developing new evals.
 * To create a Stagehand project with best practices and configuration, run:
 *
 * npx create-browser-app@latest my-browser-app
 */

import { experimental_createMCPClient } from "ai";
import { Experimental_StdioMCPTransport } from "ai/mcp-stdio";
import { z } from "zod";
import { Stagehand } from "../lib";
import StagehandConfig from "../stagehand.config";
// import { MCPClient } from "mcp-client";

async function example(stagehand: Stagehand) {
  /**
   * Add your code here!
   */
  const page = stagehand.page;
  await page.goto("https://www.google.com");
  await page.extract({
    instruction: "fetch https://aigrant.com/ and return the html",
    schema: z.object({
      html: z.string(),
    }),
  });
}

(async () => {
  const transport = new Experimental_StdioMCPTransport({
    command: "node",
    args: [
      "/Users/sameelarif/Documents/GitHub/mcp-servers/fetch-mcp/dist/index.js",
    ],
  });
  const client = await experimental_createMCPClient({
    transport,
  });

  const fetchTools = await client.tools();

  const stagehand = new Stagehand({
    ...StagehandConfig,
    env: "LOCAL",
    modelName: "openai/gpt-4o",
    useAPI: false,
    tools: fetchTools,
  });
  await stagehand.init();
  await example(stagehand);
  await stagehand.close();
})();
