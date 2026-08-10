# Stagehand integrations

Private workspace package for Stagehand integration adapters.

The code-mode stdio entrypoint currently provides the MCP host and process lifecycle used by later code-mode capabilities. It intentionally advertises no tools yet.

The `deepagents/` Python project provides local and managed LangChain Deep Agents integrations. Both
expose stateful `run`, `snapshot`, and `screenshot` browser tools using the Stagehand Python SDK.
