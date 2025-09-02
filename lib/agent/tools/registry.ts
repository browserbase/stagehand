import { z } from "zod";

/**
 * Registry of all available Stagehand tools with their metadata
 */

export interface ToolMetadata {
  name: string;
  description: string;
  parameters?: z.ZodSchema;
}

export const TOOL_REGISTRY: Record<string, ToolMetadata> = {
  act: {
    name: "act",
    description:
      "Perform a specific action on the page (click, type, select, etc.)",
  },
  ariaTree: {
    name: "ariaTree",
    description:
      "Get an accessibility (ARIA) tree for full page context and element discovery",
  },
  close: {
    name: "close",
    description: "End the task and report completion status",
  },
  extract: {
    name: "extract",
    description: "Extract structured data from the page using a schema",
  },
  fillForm: {
    name: "fillForm",
    description: "Automatically fill out forms on the page",
  },
  goto: {
    name: "goto",
    description: "Navigate to a URL",
  },
  navback: {
    name: "navback",
    description: "Navigate back in browser history",
  },
  screenshot: {
    name: "screenshot",
    description: "Take a compressed JPEG screenshot for visual context",
  },
  scroll: {
    name: "scroll",
    description: "Scroll the page up or down by a specified amount",
  },
  wait: {
    name: "wait",
    description: "Wait for a specified amount of time",
  },
};

export type DefaultToolName = keyof typeof TOOL_REGISTRY;
