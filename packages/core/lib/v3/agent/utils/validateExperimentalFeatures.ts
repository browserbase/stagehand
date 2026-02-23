import {
  ExperimentalNotConfiguredError,
  StagehandInvalidArgumentError,
} from "../../types/public/sdkErrors.js";
import type {
  AgentConfig,
  AgentExecuteOptionsBase,
} from "../../types/public/index.js";

export interface AgentValidationOptions {
  /** Whether experimental mode is enabled */
  isExperimental: boolean;
  /** Agent config options (integrations, tools, stream, cua, etc.) */
  agentConfig?: Partial<AgentConfig>;
  /** Execute options (callbacks, signal, messages, etc.) */
  executeOptions?:
    | (Partial<AgentExecuteOptionsBase> & { callbacks?: unknown })
    | null;
  /** Whether this is streaming mode (can be derived from agentConfig.stream) */
  isStreaming?: boolean;
}

/**
 * Validates agent configuration and experimental feature usage.
 *
 * This utility consolidates all validation checks for both CUA and non-CUA agent paths:
 * - Invalid argument errors for CUA (streaming, abort signal, message continuation, excludeTools, output schema are not supported)
 * - Experimental feature checks for integrations and tools (both CUA and non-CUA)
 * - Experimental feature checks for hybrid mode (requires experimental: true)
 * - Experimental feature checks for non-CUA only (callbacks, signal, messages, streaming, excludeTools, output schema)
 *
 * Throws StagehandInvalidArgumentError for invalid/unsupported configurations.
 * Throws ExperimentalNotConfiguredError if experimental features are used without experimental mode.
 */
export function validateExperimentalFeatures(
  options: AgentValidationOptions,
): void {
  const { isExperimental, agentConfig, executeOptions, isStreaming } = options;

  // Check if CUA mode is enabled (via mode: "cua" or deprecated cua: true)
  const isCuaMode =
    agentConfig?.mode !== undefined
      ? agentConfig.mode === "cua"
      : agentConfig?.cua === true;

  // CUA-specific validation: certain features are not available at all
  if (isCuaMode) {
    const unsupportedFeatures: string[] = [];

    if (agentConfig?.stream) {
      unsupportedFeatures.push("streaming");
    }
    if (executeOptions?.signal) {
      unsupportedFeatures.push("abort signal");
    }
    if (executeOptions?.messages) {
      unsupportedFeatures.push("message continuation");
    }
    if (
      executeOptions?.excludeTools &&
      executeOptions.excludeTools.length > 0
    ) {
      unsupportedFeatures.push("excludeTools");
    }
    if (executeOptions?.output) {
      unsupportedFeatures.push("output schema");
    }
    if (
      executeOptions?.variables &&
      Object.keys(executeOptions.variables).length > 0
    ) {
      unsupportedFeatures.push("variables");
    }

    if (unsupportedFeatures.length > 0) {
      throw new StagehandInvalidArgumentError(
        `${unsupportedFeatures.join(", ")} ${unsupportedFeatures.length === 1 ? "is" : "are"} not supported with CUA (Computer Use Agent) mode.`,
      );
    }
  }

  // Skip experimental checks if already in experimental mode
  if (isExperimental) return;

  const features: string[] = [];

  // Check agent config features (check array length to avoid false positives for empty arrays)
  const hasIntegrations =
    agentConfig?.integrations && agentConfig.integrations.length > 0;
  const hasTools =
    agentConfig?.tools && Object.keys(agentConfig.tools).length > 0;
  if (hasIntegrations || hasTools) {
    features.push("MCP integrations and custom tools");
  }

  // Check streaming mode (either explicit or derived from config) - only for non-CUA
  if (!isCuaMode && (isStreaming || agentConfig?.stream)) {
    features.push("streaming");
  }

  // Check execute options features - only for non-CUA
  if (executeOptions && !isCuaMode) {
    if (executeOptions.callbacks) {
      features.push("callbacks");
    }
    if (executeOptions.signal) {
      features.push("abort signal");
    }
    if (executeOptions.messages) {
      features.push("message continuation");
    }
    if (executeOptions.excludeTools && executeOptions.excludeTools.length > 0) {
      features.push("excludeTools");
    }
    if (executeOptions.output) {
      features.push("output schema");
    }
    if (
      executeOptions.variables &&
      Object.keys(executeOptions.variables).length > 0
    ) {
      features.push("variables");
    }
  }

  if (features.length > 0) {
    throw new ExperimentalNotConfiguredError(`Agent ${features.join(", ")}`);
  }
}
