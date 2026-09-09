# Langchain JS

## Integrate Stagehand with Langchain JS

Stagehand can be integrated into Langchain JS by wrapping Stagehand's browser automation functionality with the StagehandToolkit.

This toolkit provides specialized tools such as navigate, act, extract, and observe, all powered by Stagehand's underlying capabilities.

For more details on this integration and how to work with Langchain, see the official Langchain documentation.

## Use the tools

- **stagehand_navigate**: Navigate to a specific URL.
- **stagehand_act**: Perform browser automation tasks like clicking buttons and typing in fields.
- **stagehand_extract**: Extract structured data from pages using Zod schemas.
- **stagehand_observe**: Investigate the DOM for possible actions or relevant elements.

## Remote Browsers (Browserbase)

Instead of `env: "LOCAL"`, specify `env: "BROWSERBASE"` and pass in your Browserbase credentials through environment variables:

- `BROWSERBASE_API_KEY`
- `BROWSERBASE_PROJECT_ID`

## Using LangGraph Agents

The StagehandToolkit can also be plugged into LangGraph's existing agent system. This lets you orchestrate more complex flows by combining Stagehand's tools with other Langchain tools.

With the StagehandToolkit, you can quickly integrate natural-language-driven browser automation into workflows supported by Langchain. This enables use cases such as:

- Searching, extracting, and summarizing data from websites
- Automating login flows
- Navigating or clicking through forms based on instructions from a larger chain of agents

Consult Stagehand's and Langchain's official references for troubleshooting and advanced integrations or reach out to us on [Slack](https://stagehand.dev/slack).
