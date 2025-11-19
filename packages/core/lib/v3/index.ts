export { V3 } from "./v3";
export { V3 as Stagehand } from "./v3";

// Re-export common V3 types for consumers
export * from "./llm/LLMClient";
export * from "./types/public";
export * from "./agent/AgentProvider";
export * from "../utils";
export * from "./zodCompat";
export { connectToMCPServer } from "./mcp/connection";
export { V3Evaluator } from "../v3Evaluator";
