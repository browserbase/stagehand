export { V3 } from "./v3";
export { V3 as Stagehand } from "./v3";

// Re-export common V3 types for consumers
export * from "./llm/LLMClient";
export { connectToMCPServer } from "../v3/mcp/connection";
