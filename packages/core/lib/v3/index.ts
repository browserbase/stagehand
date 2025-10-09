export { V3 } from "./v3";
export { V3 as Stagehand } from "./v3";

// Re-export common V3 types for consumers
export * from "./types/agent";
export * from "./types/model";
export * from "./types/log";
export * from "./types/stagehand";
export * from "./types/stagehandApiErrors";
export * from "./types/stagehandErrors";
export * from "./llm/LLMClient";
export { connectToMCPServer } from "./mcp/connection";
