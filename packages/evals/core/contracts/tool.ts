import type { EvalLogger } from "../../logger.js";
import type {
  ActionTarget,
  FocusedTarget,
  TargetKind,
  WaitSpec,
} from "./targets.js";
import type {
  PageRepresentation,
  RepresentationOpts,
} from "./representation.js";
import type {
  Artifact,
  BrowserOwnership,
  ConnectionMode,
  EnvironmentName,
} from "./results.js";

export type ToolSurface =
  | "understudy_code"
  | "v4_code"
  | "playwright_code"
  | "cdp_code"
  | "playwright_mcp"
  | "chrome_devtools_mcp"
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
  type(
    target: string | ActionTarget | FocusedTarget,
    text: string,
  ): Promise<void>;

  press(key: string): Promise<void>;
  press(
    target: string | ActionTarget | FocusedTarget,
    key: string,
  ): Promise<void>;

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

export interface ToolStartResult {
  session: CoreSession;
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
  family:
    | "understudy"
    | "stagehand_v4"
    | "playwright"
    | "cdp"
    | "stagehand_cli"
    | "chrome_devtools";
  supportedStartupProfiles: StartupProfile[];
  supportedCapabilities: CoreCapability[];
  supportedTargetKinds: TargetKind[];
  start(input: ToolStartInput): Promise<ToolStartResult>;
}

/**
 * The MCP server / tool name a `code_handles` exposure is mounted under by an
 * agent harness. Surfaces reference the tool name in their prompt
 * instructions; the harness mounts the single "run" tool under the server.
 */
export const LLM_RUN_TOOL_SERVER = "stagehand_browser";
export const LLM_RUN_TOOL_NAME = `mcp__${LLM_RUN_TOOL_SERVER}__run`;

/**
 * `code_handles` only: the surface-specific pieces of the harness's single
 * "run" tool. The harness owns the tool mechanics (timeouts, result
 * stringification, logging); the surface owns the copy the model sees and
 * the values bound into the snippet scope.
 */
export interface LLMRunToolSpec {
  /** MCP tool description shown to the model. */
  description: string;
  /** Description of the tool's `code` parameter. */
  codeParamDescription: string;
  /** Denial message when the model requests a tool outside the allowlist. */
  denyMessage: string;
  /** Value bound to `task` in the snippet scope. */
  task: Record<string, unknown>;
  /**
   * Value bound to `console` in the snippet scope. Defaults to the
   * harness's logger-backed console when omitted.
   */
  console?: Pick<Console, "log" | "warn" | "error">;
}

/**
 * Harness-observed terminal state of a run, captured through the surface
 * itself after the agent finishes. This is what grounds grading in the task
 * artifact: the verifier's final-screenshot anchor comes from the harness's
 * own observation of the page, not from whatever image the agent chose to
 * return (code surfaces stringify tool results, so agent-returned images
 * don't exist there at all).
 */
export interface TerminalArtifact {
  screenshot?: Buffer;
  url?: string;
}

/**
 * A harness-agnostic description of how an agent harness (claude_code,
 * codex, ...) mounts a tool surface. Each surface implements this once;
 * harness drivers keep exactly three mount points and no surface knowledge:
 * - `code_handles` -> wrap `handles` in the harness's single run tool
 * - `mcp_server`   -> mount `mcpServers` config directly
 * - `cli`          -> spawn `command` with env
 */
export interface LLMExposure {
  kind: "code_handles" | "mcp_server" | "cli";
  /**
   * code_handles: named values placed in the run-tool snippet scope. The
   * harness derives the snippet argument names from these keys (plus
   * startUrl, task, and console). Names, not order, bind the values.
   */
  handles?: Record<string, unknown>;
  promptInstructions: string;
  /** mcp_server: mounted as-is by the harness. */
  mcpServers?: Record<string, unknown>;
  /** cli: spawned with env by the harness. */
  command?: { bin: string; env: Record<string, string> };
  /** code_handles: surface-specific run-tool copy and snippet bindings. */
  runTool?: LLMRunToolSpec;
  /** Extra surface facts (session URLs etc.) that flow through to the harness. */
  metadata?: Record<string, unknown>;
  /**
   * Capture the terminal page state (screenshot + URL) for artifact-grounded
   * grading. Called by the harness after the agent finishes, before cleanup.
   * Best-effort: implementations should swallow per-field failures.
   */
  captureFinalState?: () => Promise<TerminalArtifact>;
  cleanup: () => Promise<void>;
}
