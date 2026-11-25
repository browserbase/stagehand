import type { ProbeEvidence } from "stagehand-v3";
import type { EvalLogger } from "../../logger.js";
import type { ActionTarget, FocusedTarget, TargetKind, WaitSpec } from "./targets.js";
import type { PageRepresentation, RepresentationOpts } from "./representation.js";
import type { Artifact, BrowserOwnership, ConnectionMode, EnvironmentName } from "./results.js";

export type ToolSurface =
  | "understudy_code"
  | "stagehand_code"
  | "playwright_code"
  | "cdp_code"
  | "playwright_mcp"
  | "chrome_devtools_mcp"
  | "google_computer_use"
  | "anthropic_browser_toolset"
  | "stagehand_facade"
  | "stagehand_facade_legacy"
  | "browse_cli";

export type StartupProfile =
  | "runner_provided_local_cdp"
  | "runner_provided_browserbase_cdp"
  | "tool_launch_local"
  | "tool_attach_local_cdp"
  | "tool_create_browserbase"
  | "tool_attach_browserbase";

export type CoreCapability =
  | "session"
  | "navigation"
  | "evaluation"
  | "screenshot"
  | "viewport"
  | "wait"
  | "click"
  | "hover"
  | "scroll"
  | "type"
  | "press"
  | "tabs"
  | "representation";

export interface NavOpts {
  waitUntil?: "load" | "domcontentloaded" | "networkidle";
  timeoutMs?: number;
}

export interface ScreenshotOpts {
  fullPage?: boolean;
  type?: "png" | "jpeg";
  quality?: number;
}

export interface CoreLocatorHandle {
  count(): Promise<number>;
  click(): Promise<void>;
  hover(): Promise<void>;
  fill(value: string): Promise<void>;
  type(text: string, opts?: { delay?: number }): Promise<void>;
  isVisible(): Promise<boolean>;
  textContent(): Promise<string | null>;
  inputValue(): Promise<string>;
}

export interface CorePageHandle {
  readonly id: string;

  goto(url: string, opts?: NavOpts): Promise<void>;
  reload(opts?: NavOpts): Promise<void>;
  back(opts?: NavOpts): Promise<boolean>;
  forward(opts?: NavOpts): Promise<boolean>;
  goBack(opts?: NavOpts): Promise<boolean>;
  goForward(opts?: NavOpts): Promise<boolean>;

  url(): string;
  title(): Promise<string>;
  evaluate<R = unknown, Arg = unknown>(
    pageFunctionOrExpression: string | ((arg: Arg) => R | Promise<R>),
    arg?: Arg,
  ): Promise<R>;
  screenshot(opts?: ScreenshotOpts): Promise<Buffer>;

  setViewport(size: { width: number; height: number }): Promise<void>;
  setViewportSize(width: number, height: number): Promise<void>;

  wait(spec: WaitSpec): Promise<void>;
  waitForSelector(
    selector: string,
    opts?: {
      timeout?: number;
      state?: "attached" | "detached" | "visible" | "hidden";
    },
  ): Promise<boolean>;
  waitForTimeout(ms: number): Promise<void>;

  locator(selector: string): CoreLocatorHandle;

  click(target: string | ActionTarget): Promise<void>;
  click(x: number, y: number): Promise<void>;

  hover(target: string | ActionTarget): Promise<void>;
  hover(x: number, y: number): Promise<void>;

  scroll(x: number, y: number, deltaX: number, deltaY: number): Promise<void>;

  type(text: string): Promise<void>;
  type(target: string | ActionTarget | FocusedTarget, text: string): Promise<void>;

  press(key: string): Promise<void>;
  press(target: string | ActionTarget | FocusedTarget, key: string): Promise<void>;

  represent?(opts?: RepresentationOpts): Promise<PageRepresentation>;
}

export interface CoreSession {
  listPages(): Promise<CorePageHandle[]>;
  activePage(): Promise<CorePageHandle>;
  newPage(url?: string): Promise<CorePageHandle>;
  selectPage(pageId: string): Promise<void>;
  closePage(pageId: string): Promise<void>;
  close(): Promise<void>;
  getArtifacts(): Promise<Artifact[]>;
  getRawMetrics(): Promise<Record<string, unknown>>;
}

export interface ToolStartInput {
  logger: EvalLogger;
  startupProfile: StartupProfile;
  environment: "LOCAL" | "BROWSERBASE";
  providedEndpoint?: {
    kind: "ws" | "http";
    url: string;
    headers?: Record<string, string>;
  };
  browserbase?: {
    sessionId?: string;
    sessionParams?: Record<string, unknown>;
  };
}

export interface BrowserSessionLoss {
  cause: string;
  tool?: string;
  at?: string;
  provider?: "local" | "browserbase";
  sessionId?: string;
  sessionAgeMs?: number;
  sessionTimeoutMs?: number;
}

export interface RunnerToolCallResult {
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
    | Record<string, unknown>
  >;
  isError?: boolean;
}

export interface ToolStartResult {
  session: CoreSession;
  agentMount?: AgentMount;
  captureEvidence?: () => Promise<ProbeEvidence>;
  callTool?: (
    name: string,
    args: Record<string, unknown>,
    options?: { timeoutMs?: number },
  ) => Promise<RunnerToolCallResult>;
  browserSessionLoss?: () => BrowserSessionLoss | undefined;
  cleanup: () => Promise<void>;
  metadata: {
    environment: EnvironmentName;
    browserOwnership: BrowserOwnership;
    connectionMode: ConnectionMode;
    [key: string]: unknown;
  };
}

export interface CoreTool {
  id: ToolSurface;
  surface: "code" | "mcp" | "cli";
  family: "understudy" | "stagehand" | "playwright" | "cdp" | "stagehand_cli" | "chrome_devtools";
  supportedStartupProfiles: StartupProfile[];
  supportedCapabilities: CoreCapability[];
  supportedTargetKinds: TargetKind[];
  start(input: ToolStartInput): Promise<ToolStartResult>;
}

export const AGENT_RUN_TOOL_SERVER = "stagehand_browser";
export const AGENT_RUN_TOOL_NAME = `mcp__${AGENT_RUN_TOOL_SERVER}__run`;
export const AGENT_RUN_TOOL_RESERVED_HANDLES = ["startUrl", "task", "console"] as const;

export interface AgentRunToolSpec {
  description: string;
  codeParamDescription: string;
  denyMessage: string;
}

export type AgentMount = { promptInstructions: string } & (
  | {
      via: "handles";
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
        env?: Record<string, string>;
      };
    }
);
