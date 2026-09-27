import { Stagehand } from "@browserbasehq/stagehand";
import { StagehandToolkit } from "@stagehand/langchain";

const stagehand = new Stagehand({
  env: "LOCAL",
  verbose: 2,
  enableCaching: false,
});

const stagehandToolkit = await StagehandToolkit.fromStagehand(stagehand);

// Find the relevant tool
const navigateTool = stagehandToolkit.tools.find((t) => t.name === "stagehand_navigate");

// Invoke it
await navigateTool.invoke("https://www.google.com");

// Suppose you want to act on the page
const actionTool = stagehandToolkit.tools.find((t) => t.name === "stagehand_act");

await actionTool.invoke('Search for "OpenAI"');

// Observe the current page
const observeTool = stagehandToolkit.tools.find((t) => t.name === "stagehand_observe");

const result = await observeTool.invoke("What actions can be performed on the current page?");

console.log(JSON.parse(result));

// Verification
const currentUrl = stagehand.page.url();
console.log("Current URL:", currentUrl);
