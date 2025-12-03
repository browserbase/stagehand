import {
  ExperimentalNotConfiguredError,
  StagehandInvalidArgumentError,
} from "../../types/public/sdkErrors";
import type { AgentConfig, AgentExecuteOptionsBase } from "../../types/public";

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
 * - Invalid argument errors for CUA (streaming, abort signal, message continuation are not supported)
 * - Experimental feature checks for non-CUA (integrations, tools, callbacks, signal, messages, streaming)
 *
 * Throws StagehandInvalidArgumentError for invalid/unsupported configurations.
 * Throws ExperimentalNotConfiguredError if experimental features are used without experimental mode.
 */
export function validateExperimentalFeatures(
  options: AgentValidationOptions,
): void {
  const { isExperimental, agentConfig, executeOptions, isStreaming } = options;

  // CUA-specific validation: certain features are not available at all
  if (agentConfig?.cua) {
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

    if (unsupportedFeatures.length > 0) {
      throw new StagehandInvalidArgumentError(
        `${unsupportedFeatures.join(", ")} ${unsupportedFeatures.length === 1 ? "is" : "are"} not supported with CUA (Computer Use Agent) mode.`,
      );
    }
  }

  // Skip experimental checks if already in experimental mode
  if (isExperimental) return;

  const features: string[] = [];

  // Check agent config features
  if (agentConfig?.integrations || agentConfig?.tools) {
    features.push("MCP integrations and custom tools");
  }

  // Check streaming mode (either explicit or derived from config) - only for non-CUA
  if (!agentConfig?.cua && (isStreaming || agentConfig?.stream)) {
    features.push("streaming");
  }

  // Check execute options features - only for non-CUA
  if (executeOptions && !agentConfig?.cua) {
    if (executeOptions.callbacks) {
      features.push("callbacks");
    }
    if (executeOptions.signal) {
      features.push("abort signal");
    }
    if (executeOptions.messages) {
      features.push("message continuation");
    }
  }

  if (features.length > 0) {
    throw new ExperimentalNotConfiguredError(`Agent ${features.join(", ")}`);
  }
}
