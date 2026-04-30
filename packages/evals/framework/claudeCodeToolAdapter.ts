import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Browser, BrowserContext, Page } from "playwright";
import { z } from "zod/v4";
import { EvalsError } from "../errors.js";
import type { EvalLogger } from "../logger.js";
import { getRepoRootDir } from "../runtimePaths.js";
import type { StartupProfile, ToolSurface } from "../core/contracts/tool.js";
import { prepareCoreBrowserTarget } from "../core/targets/index.js";
import { CdpConnection, type CdpEventMessage } from "../core/tools/cdp_code.js";
import type { ExternalHarnessTaskPlan } from "./externalHarnessPlan.js";

export interface ClaudeCodeToolAdapterInput {
  toolSurface?: ToolSurface;
  startupProfile?: StartupProfile;
  environment: "LOCAL" | "BROWSERBASE";
  plan: ExternalHarnessTaskPlan;
  logger: EvalLogger;
}

export interface PreparedClaudeCodeToolAdapter {
  toolSurface: ToolSurface;
  startupProfile: StartupProfile;
  cwd: string;
  env: Record<string, string>;
  allowedTools: string[];
  settingSources: string[];
  promptInstructions: string;
  mcpServers?: Record<string, unknown>;
  canUseTool?: (
    toolName: string,
    input: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  cleanup: () => Promise<void>;
}

export interface PreparedBrowseCliHarnessAdapter {
  toolSurface: "browse_cli";
  startupProfile: StartupProfile;
  cwd: string;
  env: Record<string, string>;
  promptInstructions: string;
  metadata: BrowseCliToolMetadata;
  cleanup: () => Promise<void>;
}

export interface BrowseCliHarnessAdapterInput {
  startupProfile: StartupProfile;
  environment: "LOCAL" | "BROWSERBASE";
  plan: ExternalHarnessTaskPlan;
  logger: EvalLogger;
  logCategory: string;
}

const BROWSE_CLI_ENTRYPOINT = path.join(
  getRepoRootDir(),
  "packages",
  "cli",
  "dist",
  "index.js",
);
const BROWSE_CLI_PACKAGE_JSON = path.join(
  getRepoRootDir(),
  "packages",
  "cli",
  "package.json",
);
const BROWSER_SKILL_SOURCE = path.join(
  getRepoRootDir(),
  "packages",
  "evals",
  "skills",
  "browser",
  "SKILL.md",
);
const ALLOW_UNSANDBOXED_LOCAL_ENV = "EVAL_CLAUDE_CODE_ALLOW_UNSANDBOXED_LOCAL";
const RUN_TOOL_SERVER = "stagehand_browser";
const RUN_TOOL_NAME = `mcp__${RUN_TOOL_SERVER}__run`;

type ClaudeToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

type SdkToolFactory = (
  name: string,
  description: string,
  inputSchema: Record<string, unknown>,
  handler: (args: { code: string }) => Promise<ClaudeToolResult>,
  extras?: Record<string, unknown>,
) => unknown;

type SdkMcpServerFactory = (options: {
  name: string;
  version?: string;
  tools?: unknown[];
  alwaysLoad?: boolean;
}) => unknown;

type ActiveCdpPage = {
  targetId: string;
  sessionId: string;
  url: string;
};

type CdpRuntime = {
  readonly targetId: string;
  readonly sessionId: string;
  send<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<T>;
  browser<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<T>;
  on(
    method: string,
    listener: (event: CdpEventMessage) => unknown | Promise<unknown>,
  ): () => void;
  off(
    method: string,
    listener: (event: CdpEventMessage) => unknown | Promise<unknown>,
  ): void;
  once(
    method: string,
    listenerOrTimeout?:
      | ((event: CdpEventMessage) => unknown | Promise<unknown>)
      | number,
    timeoutMs?: number,
  ): Promise<CdpEventMessage> | (() => void);
  waitForEvent(method: string, timeoutMs?: number): Promise<CdpEventMessage>;
  wait(ms: number): Promise<void>;
};

export interface BrowseCliToolMetadata {
  toolCommand: "browse";
  browseCliEntrypoint: string;
  browseCliVersion?: string;
}

export function getBrowseCliToolMetadata(): BrowseCliToolMetadata {
  return {
    toolCommand: "browse",
    browseCliEntrypoint: BROWSE_CLI_ENTRYPOINT,
    ...readBrowseCliVersion(),
  };
}

export function allowUnsandboxedLocalClaudeCode(): boolean {
  return process.env[ALLOW_UNSANDBOXED_LOCAL_ENV] === "true";
}

export function getBrowseCliAllowedTools(): string[] {
  return allowUnsandboxedLocalClaudeCode() ? ["Skill", "Bash"] : ["Skill"];
}

export async function prepareClaudeCodeToolAdapter(
  input: ClaudeCodeToolAdapterInput,
): Promise<PreparedClaudeCodeToolAdapter> {
  const toolSurface = resolveClaudeCodeToolSurface(input.toolSurface);
  const startupProfile = resolveClaudeCodeStartupProfile(
    toolSurface,
    input.environment,
    input.startupProfile,
  );

  switch (toolSurface) {
    case "browse_cli":
      return prepareBrowseCliAdapter({
        ...input,
        toolSurface,
        startupProfile,
      });
    case "playwright_code":
      return preparePlaywrightCodeAdapter({
        ...input,
        toolSurface,
        startupProfile,
      });
    case "cdp_code":
      return prepareCdpCodeAdapter({
        ...input,
        toolSurface,
        startupProfile,
      });
    default:
      throw new EvalsError(
        `Claude Code harness supports --tool browse_cli, playwright_code, or cdp_code for execution right now; received "${toolSurface}".`,
      );
  }
}

export function resolveClaudeCodeToolSurface(
  requested?: ToolSurface,
): ToolSurface {
  if (!requested) return "browse_cli";
  if (
    requested === "browse_cli" ||
    requested === "playwright_code" ||
    requested === "cdp_code"
  ) {
    return requested;
  }
  throw new EvalsError(
    `Claude Code harness supports --tool browse_cli, playwright_code, or cdp_code for execution right now; received "${requested}".`,
  );
}

export function resolveClaudeCodeStartupProfile(
  toolSurface: ToolSurface,
  environment: "LOCAL" | "BROWSERBASE",
  requested?: StartupProfile,
): StartupProfile {
  if (requested) return requested;

  if (toolSurface === "browse_cli") {
    return environment === "BROWSERBASE"
      ? "tool_create_browserbase"
      : "tool_launch_local";
  }
  if (toolSurface === "playwright_code" || toolSurface === "cdp_code") {
    return environment === "BROWSERBASE"
      ? "runner_provided_browserbase_cdp"
      : "runner_provided_local_cdp";
  }

  throw new EvalsError(
    `No Claude Code startup profile default for tool "${toolSurface}" in ${environment}.`,
  );
}

async function prepareBrowseCliAdapter(
  input: ClaudeCodeToolAdapterInput & {
    toolSurface: "browse_cli";
    startupProfile: StartupProfile;
  },
): Promise<PreparedClaudeCodeToolAdapter> {
  const adapter = await prepareBrowseCliHarnessAdapter({
    startupProfile: input.startupProfile,
    environment: input.environment,
    plan: input.plan,
    logger: input.logger,
    logCategory: "claude_code",
  });

  if (allowUnsandboxedLocalClaudeCode()) {
    input.logger.warn({
      category: "claude_code",
      message: `${ALLOW_UNSANDBOXED_LOCAL_ENV}=true: raw Bash auto-approval is enabled for Claude Code. Use only in an isolated checkout/container.`,
      level: 0,
    });
  }

  return {
    ...adapter,
    allowedTools: getBrowseCliAllowedTools(),
    settingSources: ["project"],
    canUseTool: async (toolName, commandInput) => {
      if (toolName === "Skill") {
        return { behavior: "allow", updatedInput: commandInput };
      }
      if (toolName !== "Bash") {
        return {
          behavior: "deny",
          message: "Only Skill and Bash are allowed.",
        };
      }

      const command = readCommand(commandInput);
      if (!isAllowedBrowseCommand(command)) {
        return {
          behavior: "deny",
          message: "Only browse commands are allowed for this eval harness.",
        };
      }

      return { behavior: "allow", updatedInput: commandInput };
    },
  };
}

export async function prepareBrowseCliHarnessAdapter(
  input: BrowseCliHarnessAdapterInput,
): Promise<PreparedBrowseCliHarnessAdapter> {
  if (!fs.existsSync(BROWSE_CLI_ENTRYPOINT)) {
    throw new EvalsError(
      `browse_cli requires a built CLI entrypoint at ${BROWSE_CLI_ENTRYPOINT}. Run pnpm --dir packages/cli build first.`,
    );
  }

  if (
    (input.environment === "LOCAL" &&
      input.startupProfile !== "tool_launch_local") ||
    (input.environment === "BROWSERBASE" &&
      input.startupProfile !== "tool_create_browserbase")
  ) {
    throw new EvalsError(
      `browse_cli startup profile "${input.startupProfile}" is not valid for environment "${input.environment}".`,
    );
  }

  const session = createBrowseSessionName();
  const cwd = await fsp.mkdtemp(
    path.join(os.tmpdir(), "stagehand-evals-claude-browse-"),
  );
  const wrapperPath = path.join(cwd, "browse");
  await installBrowserSkill(cwd);
  input.logger.log({
    category: input.logCategory,
    message: `Installed browser skill at ${path.join(cwd, ".claude", "skills", "browser", "SKILL.md")}`,
    level: 1,
  });
  const env = {
    ...process.env,
    BROWSE_SESSION: session,
    PATH: `${cwd}${path.delimiter}${process.env.PATH ?? ""}`,
  } as Record<string, string>;

  await fsp.writeFile(
    wrapperPath,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      `exec ${JSON.stringify(process.execPath)} ${JSON.stringify(BROWSE_CLI_ENTRYPOINT)} --json --session ${JSON.stringify(session)} "$@"`,
      "",
    ].join("\n"),
    { mode: 0o755 },
  );

  await runBrowseSetup(wrapperPath, input.environment, input.logger, env, cwd);

  return {
    toolSurface: "browse_cli",
    startupProfile: input.startupProfile,
    cwd,
    env,
    promptInstructions: buildBrowseCliPromptInstructions(input.plan),
    metadata: getBrowseCliToolMetadata(),
    cleanup: async () => {
      await runBrowseCommand(
        wrapperPath,
        ["stop", "--force"],
        input.logger,
        env,
        cwd,
      ).catch((): undefined => undefined);
      await fsp.rm(cwd, { recursive: true, force: true });
    },
  };
}

async function preparePlaywrightCodeAdapter(
  input: ClaudeCodeToolAdapterInput & {
    toolSurface: "playwright_code";
    startupProfile: StartupProfile;
  },
): Promise<PreparedClaudeCodeToolAdapter> {
  if (
    input.startupProfile !== "runner_provided_local_cdp" &&
    input.startupProfile !== "runner_provided_browserbase_cdp"
  ) {
    throw new EvalsError(
      `playwright_code startup profile "${input.startupProfile}" is not valid for Claude Code. Use runner_provided_local_cdp or runner_provided_browserbase_cdp.`,
    );
  }

  const cwd = await fsp.mkdtemp(
    path.join(os.tmpdir(), "stagehand-evals-claude-playwright-"),
  );
  const env = { ...process.env } as Record<string, string>;
  let browser: Browser | undefined;
  let targetCleanup: () => Promise<void> = async () => {};

  try {
    const target = await prepareCoreBrowserTarget({
      environment: input.environment,
      toolSurface: "playwright_code",
      startupProfile: input.startupProfile,
    });
    targetCleanup = target.cleanup;
    if (!target.providedEndpoint?.url) {
      throw new EvalsError(
        `playwright_code requires a runner-provided CDP endpoint for startup profile "${input.startupProfile}".`,
      );
    }

    const { chromium } = await import("playwright");
    browser = await chromium.connectOverCDP(target.providedEndpoint.url, {
      headers: target.providedEndpoint.headers,
    });
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());
    const mcpServers = await buildPlaywrightRunMcpServers({
      browser,
      context,
      page,
      plan: input.plan,
      logger: input.logger,
    });

    input.logger.log({
      category: "claude_code",
      message: `Initialized playwright_code browser runtime for Claude Code run tool.`,
      level: 1,
      auxiliary: {
        startupProfile: {
          value: input.startupProfile,
          type: "string",
        },
        environment: {
          value: input.environment,
          type: "string",
        },
        ...(target.metadata && {
          targetMetadata: {
            value: JSON.stringify(target.metadata),
            type: "object",
          },
        }),
      },
    });

    return {
      toolSurface: "playwright_code",
      startupProfile: input.startupProfile,
      cwd,
      env,
      allowedTools: ["Bash", RUN_TOOL_NAME],
      settingSources: [],
      mcpServers,
      canUseTool: async (toolName, commandInput) => {
        if (toolName === RUN_TOOL_NAME || toolName === "Bash") {
          return { behavior: "allow", updatedInput: commandInput };
        }
        return {
          behavior: "deny",
          message: `Use Bash for inspection and ${RUN_TOOL_NAME} for browser automation.`,
        };
      },
      promptInstructions: buildPlaywrightCodePromptInstructions(input.plan),
      cleanup: async () => {
        try {
          await browser?.close();
        } catch {
          // best-effort only
        } finally {
          await targetCleanup();
          await fsp.rm(cwd, { recursive: true, force: true });
        }
      },
    };
  } catch (error) {
    try {
      await browser?.close();
    } catch {
      // best-effort only
    }
    await targetCleanup();
    await fsp.rm(cwd, { recursive: true, force: true });
    throw error;
  }
}

async function prepareCdpCodeAdapter(
  input: ClaudeCodeToolAdapterInput & {
    toolSurface: "cdp_code";
    startupProfile: StartupProfile;
  },
): Promise<PreparedClaudeCodeToolAdapter> {
  if (
    input.startupProfile !== "runner_provided_local_cdp" &&
    input.startupProfile !== "runner_provided_browserbase_cdp"
  ) {
    throw new EvalsError(
      `cdp_code startup profile "${input.startupProfile}" is not valid for Claude Code. Use runner_provided_local_cdp or runner_provided_browserbase_cdp.`,
    );
  }

  const cwd = await fsp.mkdtemp(
    path.join(os.tmpdir(), "stagehand-evals-claude-cdp-"),
  );
  const env = { ...process.env } as Record<string, string>;
  let connection: CdpConnection | undefined;
  let targetCleanup: () => Promise<void> = async () => {};

  try {
    const target = await prepareCoreBrowserTarget({
      environment: input.environment,
      toolSurface: "cdp_code",
      startupProfile: input.startupProfile,
    });
    targetCleanup = target.cleanup;
    if (!target.providedEndpoint?.url) {
      throw new EvalsError(
        `cdp_code requires a runner-provided CDP endpoint for startup profile "${input.startupProfile}".`,
      );
    }

    connection = await CdpConnection.connect(target.providedEndpoint);
    const activePage = await attachActiveCdpPage(connection);
    const mcpServers = await buildCdpRunMcpServers({
      connection,
      activePage,
      plan: input.plan,
      logger: input.logger,
    });

    input.logger.log({
      category: "claude_code",
      message: `Initialized cdp_code browser runtime for Claude Code run tool.`,
      level: 1,
      auxiliary: {
        startupProfile: {
          value: input.startupProfile,
          type: "string",
        },
        environment: {
          value: input.environment,
          type: "string",
        },
        targetId: {
          value: activePage.targetId,
          type: "string",
        },
        sessionId: {
          value: activePage.sessionId,
          type: "string",
        },
        ...(target.metadata && {
          targetMetadata: {
            value: JSON.stringify(target.metadata),
            type: "object",
          },
        }),
      },
    });

    return {
      toolSurface: "cdp_code",
      startupProfile: input.startupProfile,
      cwd,
      env,
      allowedTools: ["Bash", RUN_TOOL_NAME],
      settingSources: [],
      mcpServers,
      canUseTool: async (toolName, commandInput) => {
        if (toolName === RUN_TOOL_NAME || toolName === "Bash") {
          return { behavior: "allow", updatedInput: commandInput };
        }
        return {
          behavior: "deny",
          message: `Use Bash for inspection and ${RUN_TOOL_NAME} for CDP browser automation.`,
        };
      },
      promptInstructions: buildCdpCodePromptInstructions(input.plan),
      cleanup: async () => {
        try {
          await connection?.close();
        } catch {
          // best-effort only
        } finally {
          await targetCleanup();
          await fsp.rm(cwd, { recursive: true, force: true });
        }
      },
    };
  } catch (error) {
    try {
      await connection?.close();
    } catch {
      // best-effort only
    }
    await targetCleanup();
    await fsp.rm(cwd, { recursive: true, force: true });
    throw error;
  }
}

async function buildPlaywrightRunMcpServers(input: {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  plan: ExternalHarnessTaskPlan;
  logger: EvalLogger;
}): Promise<Record<string, unknown>> {
  const sdk = (await import("@anthropic-ai/claude-agent-sdk")) as unknown as {
    createSdkMcpServer: SdkMcpServerFactory;
    tool: SdkToolFactory;
  };

  const runTool = sdk.tool(
    "run",
    [
      "Execute JavaScript against the initialized Playwright browser.",
      "The snippet runs inside an async function with page, context, browser, startUrl, task, and console in scope.",
      "Use await directly. Return a JSON-serializable value when useful.",
    ].join(" "),
    {
      code: z
        .string()
        .describe(
          "JavaScript function body to execute. page/context/browser/startUrl/task are already in scope.",
        ),
    },
    async ({ code }) => {
      return executePlaywrightRunTool({
        code,
        browser: input.browser,
        context: input.context,
        page: input.page,
        plan: input.plan,
        logger: input.logger,
      });
    },
    { alwaysLoad: true },
  );

  return {
    [RUN_TOOL_SERVER]: sdk.createSdkMcpServer({
      name: RUN_TOOL_SERVER,
      version: "1.0.0",
      tools: [runTool],
      alwaysLoad: true,
    }),
  };
}

async function executePlaywrightRunTool(input: {
  code: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  plan: ExternalHarnessTaskPlan;
  logger: EvalLogger;
}): Promise<ClaudeToolResult> {
  try {
    const result = await withTimeout(
      executePlaywrightSnippet(input),
      readPositiveIntEnv("EVAL_CLAUDE_CODE_RUN_TOOL_TIMEOUT_MS", 60_000),
    );
    const text = stringifyToolResult(result);
    input.logger.log({
      category: "claude_code",
      message: `run tool completed: ${clip(text, 500)}`,
      level: 1,
    });
    return {
      content: [{ type: "text", text }],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    input.logger.warn({
      category: "claude_code",
      message: `run tool failed: ${message}`,
      level: 1,
    });
    return {
      isError: true,
      content: [{ type: "text", text: message }],
    };
  }
}

async function executePlaywrightSnippet(input: {
  code: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  plan: ExternalHarnessTaskPlan;
  logger: EvalLogger;
}): Promise<unknown> {
  const AsyncFunction = Object.getPrototypeOf(async function () {})
    .constructor as new (
    ...args: string[]
  ) => (...values: unknown[]) => Promise<unknown>;
  const fn = new AsyncFunction(
    "page",
    "context",
    "browser",
    "startUrl",
    "task",
    "console",
    input.code,
  );
  return fn(
    input.page,
    input.context,
    input.browser,
    input.plan.startUrl,
    {
      dataset: input.plan.dataset,
      id: input.plan.taskId,
      startUrl: input.plan.startUrl,
      instruction: input.plan.instruction,
    },
    buildRunToolConsole(input.logger),
  );
}

async function buildCdpRunMcpServers(input: {
  connection: CdpConnection;
  activePage: ActiveCdpPage;
  plan: ExternalHarnessTaskPlan;
  logger: EvalLogger;
}): Promise<Record<string, unknown>> {
  const sdk = (await import("@anthropic-ai/claude-agent-sdk")) as unknown as {
    createSdkMcpServer: SdkMcpServerFactory;
    tool: SdkToolFactory;
  };

  const runTool = sdk.tool(
    "run",
    [
      "Execute JavaScript against the initialized Chrome DevTools Protocol browser.",
      "The snippet runs inside an async function with cdp, startUrl, task, and console in scope.",
      "Use await directly. Return a JSON-serializable value when useful.",
    ].join(" "),
    {
      code: z
        .string()
        .describe(
          "JavaScript function body to execute. cdp/startUrl/task are already in scope.",
        ),
    },
    async ({ code }) => {
      return executeCdpRunTool({
        code,
        connection: input.connection,
        activePage: input.activePage,
        plan: input.plan,
        logger: input.logger,
      });
    },
    { alwaysLoad: true },
  );

  return {
    [RUN_TOOL_SERVER]: sdk.createSdkMcpServer({
      name: RUN_TOOL_SERVER,
      version: "1.0.0",
      tools: [runTool],
      alwaysLoad: true,
    }),
  };
}

async function executeCdpRunTool(input: {
  code: string;
  connection: CdpConnection;
  activePage: ActiveCdpPage;
  plan: ExternalHarnessTaskPlan;
  logger: EvalLogger;
}): Promise<ClaudeToolResult> {
  try {
    const result = await withTimeout(
      executeCdpSnippet(input),
      readPositiveIntEnv("EVAL_CLAUDE_CODE_RUN_TOOL_TIMEOUT_MS", 60_000),
    );
    const text = stringifyToolResult(result);
    input.logger.log({
      category: "claude_code",
      message: `run tool completed: ${clip(text, 500)}`,
      level: 1,
    });
    return {
      content: [{ type: "text", text }],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    input.logger.warn({
      category: "claude_code",
      message: `run tool failed: ${message}`,
      level: 1,
    });
    return {
      isError: true,
      content: [{ type: "text", text: message }],
    };
  }
}

async function executeCdpSnippet(input: {
  code: string;
  connection: CdpConnection;
  activePage: ActiveCdpPage;
  plan: ExternalHarnessTaskPlan;
  logger: EvalLogger;
}): Promise<unknown> {
  const AsyncFunction = Object.getPrototypeOf(async function () {})
    .constructor as new (
    ...args: string[]
  ) => (...values: unknown[]) => Promise<unknown>;
  const fn = new AsyncFunction(
    "cdp",
    "startUrl",
    "task",
    "console",
    input.code,
  );
  return fn(
    buildCdpRuntime(input.connection, input.activePage, input.logger),
    input.plan.startUrl,
    {
      dataset: input.plan.dataset,
      id: input.plan.taskId,
      startUrl: input.plan.startUrl,
      instruction: input.plan.instruction,
    },
    buildRunToolConsole(input.logger),
  );
}

function buildCdpRuntime(
  connection: CdpConnection,
  activePage: ActiveCdpPage,
  logger: EvalLogger,
): CdpRuntime {
  const listenerUnsubscribes = new Map<
    (event: CdpEventMessage) => unknown | Promise<unknown>,
    () => void
  >();
  return {
    targetId: activePage.targetId,
    sessionId: activePage.sessionId,
    send: <T = unknown>(
      method: string,
      params?: Record<string, unknown>,
    ): Promise<T> => connection.send<T>(method, params, activePage.sessionId),
    browser: <T = unknown>(
      method: string,
      params?: Record<string, unknown>,
    ): Promise<T> => connection.send<T>(method, params),
    on: (
      method: string,
      listener: (event: CdpEventMessage) => unknown | Promise<unknown>,
    ): (() => void) => {
      const unsubscribe = onCdpEvent(
        connection,
        activePage.sessionId,
        method,
        listener,
        logger,
      );
      listenerUnsubscribes.set(listener, unsubscribe);
      return () => {
        listenerUnsubscribes.delete(listener);
        unsubscribe();
      };
    },
    off: (
      _method: string,
      listener: (event: CdpEventMessage) => unknown | Promise<unknown>,
    ): void => {
      const unsubscribe = listenerUnsubscribes.get(listener);
      listenerUnsubscribes.delete(listener);
      unsubscribe?.();
    },
    once: (
      method: string,
      listenerOrTimeout?:
        | ((event: CdpEventMessage) => unknown | Promise<unknown>)
        | number,
      timeoutMs = 15_000,
    ): Promise<CdpEventMessage> | (() => void) => {
      if (typeof listenerOrTimeout === "function") {
        const listener = listenerOrTimeout;
        const unsubscribe = onCdpEvent(
          connection,
          activePage.sessionId,
          method,
          (event) => {
            unsubscribe?.();
            listenerUnsubscribes.delete(listener);
            return listener(event);
          },
          logger,
        );
        listenerUnsubscribes.set(listener, unsubscribe);
        return () => {
          listenerUnsubscribes.delete(listener);
          unsubscribe?.();
        };
      }
      return waitForCdpEvent(
        connection,
        activePage.sessionId,
        method,
        listenerOrTimeout ?? timeoutMs,
      );
    },
    waitForEvent: (
      method: string,
      timeoutMs = 15_000,
    ): Promise<CdpEventMessage> =>
      waitForCdpEvent(connection, activePage.sessionId, method, timeoutMs),
    wait: sleep,
  };
}

function onCdpEvent(
  connection: CdpConnection,
  sessionId: string,
  method: string,
  listener: (event: CdpEventMessage) => unknown | Promise<unknown>,
  logger: EvalLogger,
): () => void {
  return connection.onEvent((event) => {
    if (
      event.method !== method ||
      (event.sessionId && event.sessionId !== sessionId)
    ) {
      return;
    }
    try {
      const result = listener(event);
      if (isPromiseLike(result)) {
        result.catch((error: unknown) => {
          logger.warn({
            category: "claude_code",
            message: `cdp event listener failed: ${error instanceof Error ? error.message : String(error)}`,
            level: 1,
          });
        });
      }
    } catch (error) {
      logger.warn({
        category: "claude_code",
        message: `cdp event listener failed: ${error instanceof Error ? error.message : String(error)}`,
        level: 1,
      });
    }
  });
}

async function attachActiveCdpPage(
  connection: CdpConnection,
): Promise<ActiveCdpPage> {
  const targets = await connection.send<{
    targetInfos: Array<{
      targetId: string;
      type: string;
      url?: string;
    }>;
  }>("Target.getTargets");

  const existingPage = targets.targetInfos.find(
    (target) =>
      target.type === "page" && !target.url?.startsWith("devtools://"),
  );
  const targetId =
    existingPage?.targetId ??
    (
      await connection.send<{ targetId: string }>("Target.createTarget", {
        url: "about:blank",
      })
    ).targetId;
  const attached = await connection.send<{ sessionId: string }>(
    "Target.attachToTarget",
    {
      targetId,
      flatten: true,
    },
  );

  await connection.send("Page.enable", {}, attached.sessionId);
  await connection.send("Runtime.enable", {}, attached.sessionId);
  await connection.send("DOM.enable", {}, attached.sessionId);
  await connection.send(
    "Page.setLifecycleEventsEnabled",
    { enabled: true },
    attached.sessionId,
  );

  return {
    targetId,
    sessionId: attached.sessionId,
    url: existingPage?.url ?? "about:blank",
  };
}

export function waitForCdpEvent(
  connection: CdpConnection,
  sessionId: string,
  method: string,
  timeoutMs: number,
): Promise<CdpEventMessage> {
  let timeout: NodeJS.Timeout | undefined;
  let unsubscribe: (() => void) | undefined;
  const promise = new Promise<CdpEventMessage>((resolve, reject) => {
    const cleanup = () => {
      if (timeout) clearTimeout(timeout);
      unsubscribe?.();
    };
    unsubscribe = connection.onEvent((event) => {
      if (
        event.method !== method ||
        (event.sessionId && event.sessionId !== sessionId)
      ) {
        return;
      }
      cleanup();
      resolve(event);
    });
    timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for CDP event "${method}"`));
    }, timeoutMs);
  });

  // Claude-generated snippets often assign an event wait promise before a CDP
  // action and may abandon it after another branch finishes. Keep the promise
  // rejectable for awaited callers, but prevent abandoned waits from crashing
  // the eval process as unhandled rejections.
  promise.catch((): undefined => undefined);
  return promise;
}

function buildRunToolConsole(
  logger: EvalLogger,
): Pick<Console, "log" | "warn" | "error"> {
  const write = (level: "log" | "warn" | "error", values: unknown[]) => {
    logger.log({
      category: "claude_code",
      message: `run console.${level}: ${values.map(stringifyToolResult).join(" ")}`,
      level: 1,
    });
  };
  return {
    log: (...values: unknown[]) => write("log", values),
    warn: (...values: unknown[]) => write("warn", values),
    error: (...values: unknown[]) => write("error", values),
  };
}

function buildPlaywrightCodePromptInstructions(
  plan: ExternalHarnessTaskPlan,
): string {
  void plan;
  return [
    "Browser tool surface: playwright_code.",
    `Use the ${RUN_TOOL_NAME} tool for browser automation. It exposes an initialized Playwright page, context, browser, startUrl, and task object.`,
    "Use Bash for inspection and lightweight scripting. Do not create a separate browser process.",
    "The first browser action should usually be: await page.goto(startUrl, { waitUntil: 'domcontentloaded' }).",
    "Do not edit repository files.",
    "Return useful JSON-serializable values from run snippets so you can inspect progress.",
  ].join("\n");
}

function buildCdpCodePromptInstructions(plan: ExternalHarnessTaskPlan): string {
  void plan;
  return [
    "Browser tool surface: cdp_code.",
    `Use the ${RUN_TOOL_NAME} tool for browser automation. It exposes an initialized cdp object, startUrl, and task object.`,
    "Use cdp.send(method, params) for page-scoped CDP commands and cdp.browser(method, params) for browser-level commands.",
    "Helpers available: cdp.on(method, listener), cdp.once(method), cdp.waitForEvent(method, timeoutMs), cdp.wait(ms), cdp.targetId, cdp.sessionId.",
    'The first browser action should usually be: const loaded = cdp.waitForEvent("Page.loadEventFired"); await cdp.send("Page.navigate", { url: startUrl }); await loaded.',
    "Use Bash for inspection and lightweight scripting. Do not create a separate browser process.",
    "Do not edit repository files.",
    "Return useful JSON-serializable values from run snippets so you can inspect progress.",
  ].join("\n");
}

async function runBrowseSetup(
  wrapperPath: string,
  environment: "LOCAL" | "BROWSERBASE",
  logger: EvalLogger,
  env: Record<string, string>,
  cwd: string,
): Promise<void> {
  await runBrowseCommand(
    wrapperPath,
    ["env", environment === "BROWSERBASE" ? "remote" : "local"],
    logger,
    env,
    cwd,
  );
}

function buildBrowseCliPromptInstructions(
  plan: ExternalHarnessTaskPlan,
): string {
  void plan;
  return [
    "Browser tool surface: browse_cli.",
    "A project skill named browser is available. Use the Skill tool to load it before using browse.",
    "Use Bash only to run the browse command. It is already on PATH and pinned to this eval session.",
    "Do not use network/web tools outside browse. Do not edit repository files.",
    "The benchmark start URL is provided above.",
  ].join("\n");
}

export async function installBrowserSkill(cwd: string): Promise<void> {
  const targetDir = path.join(cwd, ".claude", "skills", "browser");
  await fsp.mkdir(targetDir, { recursive: true });
  await fsp.copyFile(BROWSER_SKILL_SOURCE, path.join(targetDir, "SKILL.md"));
}

export function isAllowedBrowseCommand(command: string): boolean {
  const trimmed = command.trim();
  if (/[\r\n]/.test(trimmed)) return false;
  if (trimmed !== "browse" && !trimmed.startsWith("browse ")) return false;
  return !/[;&|`$<>]/.test(trimmed);
}

function readCommand(input: Record<string, unknown>): string {
  const command = input.command ?? input.cmd;
  return typeof command === "string" ? command : "";
}

function readPositiveIntEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`run tool timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function stringifyToolResult(value: unknown): string {
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function clip(value: string, maxLength: number): string {
  return value.length <= maxLength
    ? value
    : `${value.slice(0, maxLength - 1)}…`;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> & {
  catch: (handler: (error: unknown) => void) => unknown;
} {
  return (
    value !== null &&
    typeof value === "object" &&
    "then" in value &&
    typeof (value as { then?: unknown }).then === "function" &&
    "catch" in value &&
    typeof (value as { catch?: unknown }).catch === "function"
  );
}

function createBrowseSessionName(): string {
  return `evals-claude-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function runBrowseCommand(
  wrapperPath: string,
  args: string[],
  logger: EvalLogger,
  env: Record<string, string>,
  cwd: string,
): Promise<void> {
  const { spawn } = await import("node:child_process");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(wrapperPath, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      logger.log({ category: "browse_cli", message: chunk, level: 1 });
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      logger.log({ category: "browse_cli", message: chunk, level: 1 });
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new EvalsError(
          `browse_cli command failed (${args.join(" ")}): ${stderr.trim()}`,
        ),
      );
    });
  });
}

function readBrowseCliVersion(): { browseCliVersion?: string } {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(BROWSE_CLI_PACKAGE_JSON, "utf8"),
    ) as { version?: unknown };
    return typeof parsed.version === "string"
      ? { browseCliVersion: parsed.version }
      : {};
  } catch {
    return {};
  }
}
