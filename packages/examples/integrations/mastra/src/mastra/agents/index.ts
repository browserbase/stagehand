import { openai } from "@ai-sdk/openai";
import { Agent } from "@mastra/core/agent";
import {
  stagehandActTool,
  stagehandObserveTool,
  stagehandExtractTool,
  stagehandNavigateTool,
} from "../tools";

export const webAgent = new Agent({
  name: "Web Assistant",
  instructions: `
      You are a helpful web assistant that can navigate websites and extract information.

      Your primary functions are:
      - Navigate to websites
      - Observe elements on webpages
      - Perform actions like clicking buttons or filling forms
      - Extract data from webpages

      When responding:
      - Ask for a specific URL if none is provided
      - Be specific about what actions to perform
      - When extracting data, be clear about what information you need

      Use the stagehandActTool to perform actions on webpages.
      Use the stagehandObserveTool to find elements on webpages.
      Use the stagehandExtractTool to extract data from webpages.
`,
  model: openai("gpt-4o"),
  tools: { stagehandActTool, stagehandObserveTool, stagehandExtractTool, stagehandNavigateTool },
});
