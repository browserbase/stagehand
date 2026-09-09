# CrewAI Integration

Automate browser tasks using natural language instructions with CrewAI

This tool integrates the Stagehand Python SDK with CrewAI, allowing agents to interact with websites and automate browser tasks using natural language instructions.

## Description

The StagehandTool wraps the Stagehand Python SDK to provide CrewAI agents with the ability to control a real web browser and interact with websites using three core primitives:

- **Act**: Perform actions like clicking, typing, or navigating
- **Extract**: Extract structured data from web pages
- **Observe**: Identify and analyze elements on the page

## Requirements

Before using this tool, you will need:

- A Browserbase account with API key and project ID
- An API key for an LLM (OpenAI or Anthropic Claude)
- The Stagehand Python SDK installed
