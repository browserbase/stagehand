/**
 * The MCP server / tool name used when an agent harness wraps handles in a
 * code-execution tool.
 */
export const AGENT_RUN_TOOL_SERVER = "stagehand_browser";
export const AGENT_RUN_TOOL_NAME = `mcp__${AGENT_RUN_TOOL_SERVER}__run`;
export const AGENT_RUN_TOOL_RESERVED_HANDLES = ["startUrl", "task", "console"] as const;

/**
 * Surface-specific copy for the harness's code-execution tool. The harness
 * owns mechanics and task bindings; the surface owns what the agent sees.
 */
export interface AgentRunToolSpec {
  /** MCP tool description shown to the model. */
  description: string;
  /** Description of the tool's `code` parameter. */
  codeParamDescription: string;
  /** Message from the harness-owned tool allowlist when access is denied. */
  denyMessage: string;
}

/**
 * How an agent harness reaches an already-running surface. This is independent
 * of `CoreTool.surface`; harnesses switch on `via` and need no surface-specific
 * mounting logic.
 */
export type AgentMount = { promptInstructions: string } & (
  | {
      via: "handles";
      /**
       * Named values placed in snippet scope. Names, not order, bind values.
       * `AGENT_RUN_TOOL_RESERVED_HANDLES` are injected by the harness and may
       * not appear here.
       */
      handles: Record<string, unknown>;
      runTool: AgentRunToolSpec;
    }
  | { via: "mcp"; mcpServers: Record<string, unknown> }
  | {
      via: "cli";
      command: {
        bin: string;
        args?: string[];
        cwd?: string;
        /** Extra variables merged over the harness environment. */
        env?: Record<string, string>;
      };
    }
);

/** Narrow view of a running surface exposed to agent harness adapters. */
export type StartedSurface = {
  agentMount?: AgentMount;
  cleanup(): Promise<void>;
};

/** Task details shared with an agent harness adapter. */
export type HarnessTask = {
  taskId?: string;
  startUrl: string;
  instruction: string;
};

type LogLine = {
  id?: string;
  category?: string;
  message: string;
  level?: 0 | 1 | 2;
  timestamp?: string;
  auxiliary?: Record<
    string,
    {
      value: string;
      type: "object" | "string" | "html" | "integer" | "float" | "boolean";
    }
  >;
};

/** Logger surface required by agent harness adapters. */
export type HarnessLogger = {
  log(line: LogLine): void;
  warn(line: LogLine): void;
  error(line: LogLine): void;
};

/** Error raised when a harness adapter cannot complete its work. */
export class HarnessAdapterError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "HarnessAdapterError";
  }
}
