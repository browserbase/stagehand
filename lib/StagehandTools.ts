import { TOOL_REGISTRY, DefaultToolName } from "./agent/tools/registry";

/**
 * Helper class for discovering and understanding Stagehand's built-in tools
 */
export class StagehandTools {
  /**
   * List all available default tools with their descriptions
   */
  static list(): Record<string, { name: string; description: string }> {
    return Object.entries(TOOL_REGISTRY).reduce(
      (acc, [key, metadata]) => {
        acc[key] = {
          name: metadata.name,
          description: metadata.description,
        };
        return acc;
      },
      {} as Record<string, { name: string; description: string }>,
    );
  }

  /**
   * Get the names of all default tools
   */
  static names(): DefaultToolName[] {
    return Object.keys(TOOL_REGISTRY) as DefaultToolName[];
  }

  /**
   * Get description for a specific tool
   */
  static describe(toolName: string): string | undefined {
    return TOOL_REGISTRY[toolName]?.description;
  }

  /**
   * Check if a tool name is a default Stagehand tool
   */
  static isDefaultTool(toolName: string): boolean {
    return toolName in TOOL_REGISTRY;
  }
}
