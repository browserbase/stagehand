export type AgentHarnessName =
  | "claude-code"
  | "codex"
  | "gemini-cli"
  | "opencode"
  | "agent-browser"
  | "browser-use"
  | "stagehand";

export type MCPServerName =
  | "playwright"
  | "chrome-devtools"
  | "agent-browser"
  | "browser-use"
  | "stagehand-agent"
  | "understudy";

export type BrowserTargetName = "local" | "cdp";

export interface BrowserViewport {
  width: number;
  height: number;
}

export interface BrowserSessionOptions {
  type?: BrowserTargetName;
  cdpUrl?: string | null;
  executablePath?: string;
  channel?: "chrome" | "chrome-beta" | "chrome-dev" | "chrome-canary";
  headless?: boolean;
  userDataDir?: string;
  viewport?: BrowserViewport;
  args?: string[];
  ignoreHTTPSErrors?: boolean;
  connectTimeoutMs?: number;
}

export interface BrowserSessionMetadata {
  id: string;
  type: BrowserTargetName;
  cdpUrl?: string;
  browserUrl?: string;
  launched: boolean;
  headless: boolean;
  userDataDir?: string;
  viewport?: BrowserViewport;
}

export interface StdioLaunchConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface NamedStdioLaunchConfig {
  name: string;
  config: StdioLaunchConfig;
}

export interface MCPServerOptions {
  type: MCPServerName;
  name?: string;
  enabled?: boolean;
  env?: Record<string, string>;
  args?: string[];
  command?: string;
  browser?: Partial<BrowserSessionOptions>;
  transport?: "stdio";
}

export interface AgentHarnessOptions {
  type: AgentHarnessName;
  model?: string;
  cwd?: string;
  env?: Record<string, string>;
  args?: string[];
  permissionMode?: string;
  stagehandMode?: "dom" | "hybrid" | "cua";
}

export interface AgentMessage {
  id: string;
  role: "system" | "user" | "assistant";
  content: string;
  createdAt: string;
  raw?: unknown;
}

export interface AgentTurnUsage {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  raw?: unknown;
}

export interface AgentTurnResult {
  sessionId?: string;
  message: AgentMessage;
  raw?: unknown;
  usage?: AgentTurnUsage;
}

export interface AgentRunInput {
  prompt: string;
  mcpServers: NamedStdioLaunchConfig[];
  cwd: string;
}

export interface AgentHarnessRunResult {
  sessionId?: string;
  content: string;
  raw?: unknown;
  usage?: AgentTurnUsage;
}

export interface MultiAgentRunOptions {
  task: string;
  cwd?: string;
  browser?: BrowserSessionOptions;
  mcpServers?: MCPServerOptions[];
  agents: AgentHarnessOptions[];
}

export interface MultiAgentRunResult {
  browser: BrowserSessionMetadata;
  agents: Array<{
    harness: AgentHarnessName;
    sessionId?: string;
    content: string;
    error?: string;
    raw?: unknown;
    usage?: AgentTurnUsage;
  }>;
}
