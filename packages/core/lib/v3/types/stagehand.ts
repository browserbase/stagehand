import { Client } from "@modelcontextprotocol/sdk/dist/esm/client";
import { ToolSet } from "ai";
import { z } from "zod/v3";
import { AgentProviderType } from "./agent";
import { ModelConfiguration } from "./model";

export interface ActOptions {
  action: string;
  model?: ModelConfiguration;
  variables?: Record<string, string>;
  domSettleTimeoutMs?: number;
  timeoutMs?: number;
  iframes?: boolean;
  frameId?: string;
}

export interface ActResult {
  success: boolean;
  message: string;
  actionDescription: string;
  actions: Action[];
}

export interface ExtractOptions<T extends z.AnyZodObject> {
  instruction?: string;
  schema?: T;
  model?: ModelConfiguration;
  domSettleTimeoutMs?: number;
  /**
   * @deprecated The `useTextExtract` parameter has no effect in this version of Stagehand and will be removed in later versions.
   */
  useTextExtract?: boolean;
  selector?: string;
  iframes?: boolean;
  frameId?: string;
}

export type ExtractResult<T extends z.AnyZodObject> = z.infer<T>;

export interface ObserveOptions {
  instruction?: string;
  model?: ModelConfiguration;
  domSettleTimeoutMs?: number;
  returnAction?: boolean;
  selector?: string;
  /**
   * @deprecated The `onlyVisible` parameter has no effect in this version of Stagehand and will be removed in later versions.
   */
  onlyVisible?: boolean;
  drawOverlay?: boolean;
  iframes?: boolean;
  frameId?: string;
}

export interface Action {
  selector: string;
  description: string;
  backendNodeId?: number;
  method?: string;
  arguments?: string[];
}

/**
 * Configuration for agent functionality
 */
export interface AgentConfig {
  /**
   * The provider to use for agent functionality
   */
  provider?: AgentProviderType;
  /**
   * The model to use for agent functionality
   */
  model?: string;
  /**
   * The model to use for tool execution (observe/act calls within agent tools).
   * If not specified, inherits from the main model configuration.
   * Format: "provider/model" (e.g., "openai/gpt-4o-mini", "google/gemini-2.0-flash-exp")
   */
  executionModel?: string;
  /**
   * Custom instructions to provide to the agent
   */
  instructions?: string;

  /**
   * Additional options to pass to the agent client
   */
  options?: Record<string, unknown>;
  /**
   * MCP integrations - Array of Client objects
   */
  integrations?: (Client | string)[];
  /**
   * Tools passed to the agent client
   */
  tools?: ToolSet;
}

export interface HistoryEntry {
  method: "act" | "extract" | "observe" | "navigate";
  parameters: unknown;
  result: unknown;
  timestamp: string;
}

/**
 * Represents a path through a Zod schema from the root object down to a
 * particular field. The `segments` array describes the chain of keys/indices.
 *
 * - **String** segments indicate object property names.
 * - **Number** segments indicate array indices.
 *
 * For example, `["users", 0, "homepage"]` might describe reaching
 * the `homepage` field in `schema.users[0].homepage`.
 */
export interface ZodPathSegments {
  /**
   * The ordered list of keys/indices leading from the schema root
   * to the targeted field.
   */
  segments: Array<string | number>;
}
