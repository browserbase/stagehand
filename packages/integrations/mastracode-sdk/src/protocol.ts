/**
 * Wire protocol between the evals runner (parent) and the mastracode driver
 * (a child Node process that imports mastracode's own SDK).
 *
 * The parent writes one {@link MastracodeDriverRequest} JSON document to the
 * driver's stdin, then EOF. The driver answers with newline-delimited
 * {@link MastracodeDriverEvent} objects on stdout, ending with exactly one
 * `done` event. Anything the driver or mastracode logs goes to stderr.
 */

export const MASTRACODE_PROTOCOL_VERSION = 1;

export const MASTRACODE_THINKING_LEVELS = ["off", "low", "medium", "high", "xhigh", "max"] as const;
export type MastracodeThinkingLevel = (typeof MASTRACODE_THINKING_LEVELS)[number];

export interface MastracodeStdioServer {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface MastracodeDriverRequest {
  version: typeof MASTRACODE_PROTOCOL_VERSION;
  /** Task prompt, sent as the single user message. */
  prompt: string;
  /** Trusted host instructions appended to mastracode's system prompt (the eval policy). */
  hostInstructions: string;
  /** Instructions layered on the eval mode (tool-surface guidance). */
  modeInstructions?: string;
  /** mastracode model id, `<provider>/<model>` (e.g. `anthropic/claude-sonnet-4-6`). */
  modelId: string;
  /** Session thinking level; unset keeps mastracode's default. */
  thinkingLevel?: MastracodeThinkingLevel;
  /** Model steps (one per `usage_update`) before the driver aborts with `max_turns`. */
  stepBudget: number;
  /** Wall-clock limit handed to runMC; unset or 0 disables it. */
  timeoutMs?: number;
  /** Programmatic MCP servers; the only tool source the agent may see. */
  mcpServers: Record<string, MastracodeStdioServer>;
  /** Exposed tool names the eval mode allows (`<server>_<tool>`). */
  facadeToolNames: string[];
  /** Empty working directory for mastracode's project detection and workspace. */
  workspaceDir: string;
  /** Throwaway MASTRA_APP_DATA_DIR (settings, auth, LibSQL database). */
  appDataDir: string;
  /** Throwaway HOME, so global config discovery finds nothing. */
  homeDir: string;
}

/** Per-step usage, exactly as mastracode's `usage_update` event reports it. */
export interface MastracodeTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
  cacheCreationInputTokens?: number;
}

export type MastracodeDoneStatus = "completed" | "max_turns" | "aborted" | "timeout" | "error";

interface EventBase {
  v: typeof MASTRACODE_PROTOCOL_VERSION;
}

export type MastracodeDriverEvent = EventBase &
  (
    | {
        type: "ready";
        mastracodeVersion?: string;
        codeSdkVersion?: string;
        /** Tools the MCP manager registered (`<server>_<tool>`). */
        mcpTools: string[];
      }
    | {
        /** One model API request seen by the driver's fetch spy. */
        type: "request";
        index: number;
        provider: "anthropic" | "openai" | "other";
        /** Model id in the request body. */
        model: string;
        /**
         * `agent` when the request offers tools (the main agent loop); `side`
         * for tool-less calls mastracode makes on its own (thread titles,
         * observational-memory observer/reflector). Side calls emit no
         * `usage_update`, so their usage is only visible via `request_usage`.
         */
        role: "agent" | "side";
        toolNames: string[];
        /** `cache_control` markers in the request body. */
        cacheBreakpoints: number;
      }
    | {
        /** Usage parsed from the raw provider response of request `index`. */
        type: "request_usage";
        index: number;
        role: "agent" | "side";
        model: string;
        usage: {
          /** Whole prompt: uncached + cache read + cache write. */
          inputTokens: number;
          cachedInputTokens: number;
          cacheCreationInputTokens: number;
          outputTokens: number;
        };
      }
    | {
        type: "tool_start";
        toolCallId: string;
        toolName: string;
        args: unknown;
        /** Reasoning and narration the model produced since the previous tool call. */
        reasoning?: string;
      }
    | {
        type: "tool_end";
        toolCallId: string;
        result: unknown;
        isError: boolean;
        denied: boolean;
      }
    | {
        /** One model step: emitted on every `usage_update`. */
        type: "step";
        index: number;
        usage: MastracodeTokenUsage;
        hadToolCalls: boolean;
        /** Assistant text streamed during this step. */
        text: string;
      }
    | {
        type: "violation";
        kind: "unexpected_tool" | "subagent";
        names: string[];
      }
    | {
        type: "done";
        status: MastracodeDoneStatus;
        stopReason?: string;
        /** Text of the last model step that produced text: the agent's final message. */
        finalText: string;
        steps: number;
        usageSum?: MastracodeTokenUsage;
        /** `session.getTokenUsage()` at the end of the run, for cross-checking. */
        sessionTokenUsage?: MastracodeTokenUsage;
        /** mastracode's effective thinking level at the end of the run. */
        thinkingLevel?: string;
        error?: string;
      }
  );

export type MastracodeEventOf<T extends MastracodeDriverEvent["type"]> = Extract<
  MastracodeDriverEvent,
  { type: T }
>;
