import type {
  StreamTextOnStepFinishCallback,
  StreamTextOnFinishCallback,
  StreamTextOnErrorCallback,
  StreamTextOnChunkCallback,
  ToolSet,
  ToolInvocation,
  FinishReason,
} from "ai";
import type { AgentTools } from "./tools";
import type {
  AgentHookEvent,
  AgentHookHandlers,
  AgentHookEventAdapter,
  StepStartEvent,
  StepFinishEvent,
  FinishEvent,
  ErrorEvent,
  ChunkEvent,
  AgentToolName,
  ServerToolInvocation,
  ChunkData,
  TextDeltaChunk,
  ToolCallDeltaChunk,
  ToolResultDeltaChunk,
} from "@/types/agentHooks";
import type { LogLine } from "@/types/log";

/**
 * Handles agent hook events in API mode by converting server events
 * to the appropriate AI SDK format and calling registered handlers
 */
export class AgentHookEventHandler implements AgentHookEventAdapter {
  private handlers: AgentHookHandlers;
  private logger: (message: LogLine) => void;
  private executionId: string;

  constructor(
    handlers: AgentHookHandlers,
    logger: (message: LogLine) => void,
    executionId: string,
  ) {
    this.handlers = handlers;
    this.logger = logger;
    this.executionId = executionId;
  }

  /**
   * Safely convert a tool name to AgentTools & ToolSet key type
   * Returns the tool name if valid, or defaults to 'act' for invalid names
   */
  private validateToolName(
    toolName: AgentToolName,
  ): keyof (AgentTools & ToolSet) {
    const validToolNames: AgentToolName[] = [
      "act",
      "ariaTree",
      "close",
      "extract",
      "fillForm",
      "goto",
      "navback",
      "screenshot",
      "scroll",
      "wait",
    ];

    if (validToolNames.includes(toolName)) {
      return toolName as keyof (AgentTools & ToolSet);
    }

    this.logger({
      category: "agent",
      message: `Invalid tool name: ${toolName}, defaulting to 'act'`,
      level: 1,
    });

    return "act" as keyof (AgentTools & ToolSet);
  }

  /**
   * Convert server tool invocations to AI SDK format
   */
  private convertToolInvocations(
    serverInvocations: ServerToolInvocation[],
  ): ToolInvocation[] {
    return serverInvocations.map((tool) => {
      const validatedToolName = this.validateToolName(tool.toolName);

      // Create a proper ToolInvocation based on state
      if (tool.state === "result") {
        return {
          state: "result" as const,
          toolCallId: tool.toolCallId,
          toolName: validatedToolName,
          args: tool.args,
          result: tool.result,
        } as ToolInvocation;
      } else if (tool.state === "call") {
        return {
          state: "call" as const,
          toolCallId: tool.toolCallId,
          toolName: validatedToolName,
          args: tool.args,
        } as ToolInvocation;
      } else {
        // Handle error state - default to result with error info
        return {
          state: "result" as const,
          toolCallId: tool.toolCallId,
          toolName: validatedToolName,
          args: tool.args,
          result: { error: tool.error || "Unknown error" },
        } as ToolInvocation;
      }
    });
  }

  /**
   * Process a hook event from the server and call the appropriate handler
   */
  async handleEvent(event: AgentHookEvent): Promise<void> {
    try {
      // Validate event belongs to this execution
      if (event.executionId !== this.executionId) {
        this.logger({
          category: "agent",
          message: `Received event for different execution ID: ${event.executionId}`,
          level: 2,
        });
        return;
      }

      this.logger({
        category: "agent",
        message: `Processing hook event: ${event.type}`,
        level: 2,
      });

      switch (event.type) {
        case "step_finish":
          if (this.handlers.onStepFinish) {
            const adaptedEvent = this.adaptStepFinishEvent(
              event as StepFinishEvent,
            );
            await this.handlers.onStepFinish(adaptedEvent);
          }
          break;

        case "chunk":
          if (this.handlers.onChunk) {
            const adaptedEvent = this.adaptChunkEvent(event as ChunkEvent);
            await this.handlers.onChunk(adaptedEvent);
          }
          break;

        case "error":
          if (this.handlers.onError) {
            const adaptedEvent = this.adaptErrorEvent(event as ErrorEvent);
            await this.handlers.onError(adaptedEvent);
          }
          break;

        case "finish":
          if (this.handlers.onFinish) {
            const adaptedEvent = this.adaptFinishEvent(event as FinishEvent);
            await this.handlers.onFinish(adaptedEvent);
          }
          break;

        case "step_start": {
          // Step start events are informational only, no hook to call
          const stepStartEvent = event as StepStartEvent;
          this.logger({
            category: "agent",
            message: `Step ${stepStartEvent.data.stepIndex} started: ${stepStartEvent.data.instruction}`,
            level: 1,
          });
          break;
        }

        default: {
          // TypeScript exhaustiveness check
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const _exhaustiveCheck: never = event;
          this.logger({
            category: "agent",
            message: `Unknown hook event type`,
            level: 0,
          });
          break;
        }
      }
    } catch (error) {
      this.logger({
        category: "agent",
        message: `Error handling hook event: ${error instanceof Error ? error.message : String(error)}`,
        level: 0,
      });
    }
  }

  /**
   * Adapt a step finish event to AI SDK format
   */
  adaptStepFinishEvent(
    event: StepFinishEvent,
  ): Parameters<StreamTextOnStepFinishCallback<AgentTools & ToolSet>>[0] {
    const toolInvocations: ToolInvocation[] = this.convertToolInvocations(
      event.data.result.toolInvocations,
    );

    // Validate finish reason
    const validFinishReasons: FinishReason[] = [
      "stop",
      "length",
      "content-filter",
      "tool-calls",
      "error",
      "other",
    ];
    const finishReason: FinishReason = validFinishReasons.includes(
      event.data.result.finishReason as FinishReason,
    )
      ? (event.data.result.finishReason as FinishReason)
      : "other";

    // Create a flexible result object that provides the data we have
    const result = {
      text: event.data.result.text,
      usage: {
        promptTokens: event.data.result.usage.promptTokens,
        completionTokens: event.data.result.usage.completionTokens,
        totalTokens: event.data.result.usage.totalTokens,
      },
      finishReason,
      warnings: undefined as undefined,
      experimental_providerMetadata: {
        stepIndex: event.data.stepIndex,
        isLastStep: event.data.isLastStep,
        timestamp: event.timestamp,
      } as Record<string, unknown>,
    };

    // Add tool invocations as a custom property for access in hooks
    // This is necessary because the AI SDK types don't include this field
    // but our implementation needs to provide it for backwards compatibility
    (
      result as typeof result & { toolInvocations: ToolInvocation[] }
    ).toolInvocations = toolInvocations;

    return result as Parameters<
      StreamTextOnStepFinishCallback<AgentTools & ToolSet>
    >[0];
  }

  /**
   * Adapt a finish event to AI SDK format
   */
  adaptFinishEvent(
    event: FinishEvent,
  ): Parameters<StreamTextOnFinishCallback<AgentTools & ToolSet>>[0] {
    const result = {
      text: event.data.finalResult.message,
      usage: {
        promptTokens: event.data.finalResult.usage.promptTokens,
        completionTokens: event.data.finalResult.usage.completionTokens,
        totalTokens: event.data.finalResult.usage.totalTokens,
      },
      finishReason: "stop" as FinishReason,
      warnings: undefined as undefined,
      experimental_providerMetadata: {
        totalSteps: event.data.totalSteps,
        executionTimeMs: event.data.executionTimeMs,
        success: event.data.finalResult.success,
        actions: event.data.finalResult.actions,
        timestamp: event.timestamp,
      } as Record<string, unknown>,
    };

    return result as Parameters<
      StreamTextOnFinishCallback<AgentTools & ToolSet>
    >[0];
  }

  /**
   * Adapt an error event to AI SDK format
   */
  adaptErrorEvent(event: ErrorEvent): Parameters<StreamTextOnErrorCallback>[0] {
    const error = new Error(event.data.error.message) as Error & {
      code?: string;
      stepIndex?: number;
      isRecoverable?: boolean;
      timestamp?: string;
      executionId?: string;
    };
    error.name = event.data.error.name;
    error.stack = event.data.error.stack;

    // Add custom properties for additional context
    error.code = event.data.error.code;
    error.stepIndex = event.data.stepIndex;
    error.isRecoverable = event.data.isRecoverable;
    error.timestamp = event.timestamp;
    error.executionId = event.executionId;

    return { error };
  }

  /**
   * Adapt a chunk event to AI SDK format
   */
  adaptChunkEvent(
    event: ChunkEvent,
  ): Parameters<StreamTextOnChunkCallback<AgentTools & ToolSet>>[0] {
    const chunk: ChunkData = event.data.chunk;
    const baseMetadata = {
      stepIndex: String(event.data.stepIndex),
      timestamp: event.timestamp,
    } as Record<string, unknown>;

    switch (chunk.type) {
      case "text-delta": {
        const textChunk = chunk as TextDeltaChunk;
        return {
          chunk: {
            type: "text-delta" as const,
            textDelta: textChunk.textDelta,
          },
          experimental_providerMetadata: baseMetadata,
        } as Parameters<StreamTextOnChunkCallback<AgentTools & ToolSet>>[0];
      }

      case "tool-call-delta": {
        const toolCallChunk = chunk as ToolCallDeltaChunk;
        return {
          chunk: {
            type: "tool-call-delta" as const,
            toolCallId: toolCallChunk.toolCallId,
            toolName: this.validateToolName(toolCallChunk.toolName),
            argsTextDelta: toolCallChunk.argsTextDelta,
          },
          experimental_providerMetadata: baseMetadata,
        } as Parameters<StreamTextOnChunkCallback<AgentTools & ToolSet>>[0];
      }

      case "tool-result-delta": {
        const toolResultChunk = chunk as ToolResultDeltaChunk;
        return {
          chunk: {
            type: "tool-result" as const,
            toolCallId: toolResultChunk.toolCallId,
            toolName: this.validateToolName(toolResultChunk.toolName),
            args: {}, // Required by AI SDK but not available in our event
            result: toolResultChunk.toolResult,
          },
          experimental_providerMetadata: baseMetadata,
        } as Parameters<StreamTextOnChunkCallback<AgentTools & ToolSet>>[0];
      }

      default: {
        // TypeScript exhaustiveness check - this should never happen with proper typing
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const _exhaustiveCheck: never = chunk;
        this.logger({
          category: "agent",
          message: `Unknown chunk type received`,
          level: 0,
        });
        // Fallback to text delta
        return {
          chunk: {
            type: "text-delta" as const,
            textDelta: "",
          },
          experimental_providerMetadata: baseMetadata,
        } as Parameters<StreamTextOnChunkCallback<AgentTools & ToolSet>>[0];
      }
    }
  }

  /**
   * Update the handlers for this execution
   */
  updateHandlers(handlers: AgentHookHandlers): void {
    this.handlers = handlers;
  }

  /**
   * Get the execution ID for this handler
   */
  getExecutionId(): string {
    return this.executionId;
  }
}
