import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  STAGEHAND_FACADE_MCP_TOOLS,
  toolNamesFor,
  type MastracodeStdioServer,
} from "@browserbasehq/stagehand-integrations-mastracode-sdk";
import { sanitizeErrorMessage } from "@browserbasehq/stagehand-integrations/harness";
import type { ProbeEvidence } from "stagehand-v3";
import type { BrowserSessionLoss, StartupProfile, ToolSurface } from "../core/contracts/tool.js";
import { EvalsError } from "../errors.js";
import type { EvalLogger } from "../logger.js";
import { startAgentToolRuntime } from "./agentToolRuntime.js";
import type { BrowserSessionInfo } from "./browserSession.js";
import type { ExternalHarnessTaskPlan } from "./externalHarnessPlan.js";
import { buildFxMcpChildEnv } from "./fxToolAdapter.js";
import { resolveStartupProfile, resolveToolSurface } from "./harnesses/toolSurfaceResolution.js";
import { mastraToolNameMatcher } from "./mastraToolAdapter.js";
import { ObservationRecorder, type StepObservation } from "./observationRecorder.js";

/** The contract's facade-only surface: the runner-owned Stagehand facade over MCP. */
export const MASTRACODE_TOOL_SURFACES: ToolSurface[] = ["stagehand_facade"];

/**
 * Parent variables the driver process may see. mastracode reads many more
 * (MASTRA_GATEWAY_API_KEY reroutes models through the uncached Mastra gateway,
 * TAVILY/PARALLEL keys add web tools, MASTRA_DB_* redirect storage, VITEST
 * swaps in a test key), so the driver gets an allowlist, never process.env.
 */
export const MASTRACODE_DRIVER_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_BASE_URL",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "NODE_OPTIONS",
  "TMPDIR",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
] as const;

export interface MastracodeRuntimePaths {
  root: string;
  home: string;
  appDataDir: string;
  workspace: string;
}

export function resolveMastracodeRuntimePaths(root: string): MastracodeRuntimePaths {
  return {
    root,
    home: path.join(root, "home"),
    appDataDir: path.join(root, "appdata"),
    workspace: path.join(root, "workspace"),
  };
}

/** Env for the driver process: allowlisted parent keys plus the per-task directories. */
export function buildMastracodeDriverEnv(
  paths: MastracodeRuntimePaths,
  parentEnv: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const env: Record<string, string> = { PATH: parentEnv.PATH ?? "" };
  for (const key of MASTRACODE_DRIVER_ENV_KEYS) {
    const value = parentEnv[key];
    if (typeof value === "string" && value) env[key] = value;
  }
  return {
    ...env,
    HOME: paths.home,
    MASTRA_APP_DATA_DIR: paths.appDataDir,
    MASTRA_TELEMETRY_DISABLED: "1",
  };
}

/**
 * Translate the mount's stdio MCP specs for mastracode's `mcpServers`. The MCP
 * child gets the fx allowlist (PATH, the real HOME, package-manager caches,
 * proxies) plus its own spec env, never provider API keys.
 */
export function buildMastracodeMcpServers(
  mcpServers: Record<string, unknown>,
  parentEnv: Record<string, string | undefined> = process.env,
  home: string = parentEnv.HOME ?? os.homedir(),
): Record<string, MastracodeStdioServer> {
  return Object.fromEntries(
    Object.entries(mcpServers).map(([name, raw]) => {
      if (!/^[A-Za-z0-9_-]+$/u.test(name)) {
        throw new EvalsError(`Invalid mastracode MCP server name "${name}".`);
      }
      if (!isRecord(raw) || "url" in raw || typeof raw.command !== "string") {
        throw new EvalsError(
          `mastracode MCP server "${name}" must use a stdio definition with a string command.`,
        );
      }
      const args = Array.isArray(raw.args)
        ? raw.args.filter((arg): arg is string => typeof arg === "string")
        : [];
      const specEnv = isStringRecord(raw.env) ? raw.env : {};
      const env = buildFxMcpChildEnv(specEnv, {
        home,
        pathEnv: parentEnv.PATH ?? "",
        parentEnv,
      });
      return [name, { command: raw.command, args, env }] as const;
    }),
  );
}

export interface MastracodeToolAdapterInput {
  toolSurface?: ToolSurface;
  startupProfile?: StartupProfile;
  environment: "LOCAL" | "BROWSERBASE";
  plan: ExternalHarnessTaskPlan;
  logger: EvalLogger;
  /** Test seam for runtime mounts. */
  startRuntime?: typeof startAgentToolRuntime;
}

export interface PreparedMastracodeToolAdapter {
  toolSurface: ToolSurface;
  startupProfile: StartupProfile;
  paths: MastracodeRuntimePaths;
  /** Driver process env (allowlisted). */
  env: Record<string, string>;
  mcpServers: Record<string, MastracodeStdioServer>;
  /** Exposed names of the only tools the agent may be offered. */
  facadeToolNames: string[];
  promptInstructions: string;
  browserSession: BrowserSessionInfo;
  captureEvidence?: () => Promise<ProbeEvidence>;
  browserSessionLoss?: () => BrowserSessionLoss | undefined;
  drainStepObservations?: () => Promise<StepObservation[]>;
  recordObservation?: () => void;
  observedToolMatcher: (name: string) => boolean;
  cleanup: () => Promise<void>;
}

export async function prepareMastracodeToolAdapter(
  input: MastracodeToolAdapterInput,
): Promise<PreparedMastracodeToolAdapter> {
  const toolSurface = resolveToolSurface(
    { harness: "mastracode", supportedToolSurfaces: MASTRACODE_TOOL_SURFACES },
    input.toolSurface,
  );
  if (toolSurface === undefined) {
    throw new EvalsError("mastracode harness requires a tool surface.");
  }
  const startupProfile = resolveStartupProfile(
    toolSurface,
    input.environment,
    input.startupProfile,
  );
  const startRuntime = input.startRuntime ?? startAgentToolRuntime;
  const runtime = await startRuntime({
    toolSurface,
    startupProfile,
    environment: input.environment,
    logger: input.logger,
  });
  let root: string | undefined;

  try {
    const mount = runtime.running.agentMount;
    if (!mount) {
      throw new EvalsError(`Tool surface "${toolSurface}" does not provide an agent mount.`);
    }
    if (mount.via !== "mcp") {
      throw new EvalsError(
        `mastracode does not support agent mounts delivered via "${mount.via}"; it hosts MCP servers only.`,
      );
    }
    root = await fsp.mkdtemp(path.join(os.tmpdir(), "stagehand-evals-mastracode-"));
    const paths = resolveMastracodeRuntimePaths(root);
    // The workspace stays empty: no AGENTS.md, .mcp.json, .env, or hooks to discover.
    await Promise.all(
      [paths.home, paths.appDataDir, paths.workspace].map((dir) =>
        fsp.mkdir(dir, { recursive: true }),
      ),
    );
    const serverNames = Object.keys(mount.mcpServers);
    const mcpServers = buildMastracodeMcpServers(mount.mcpServers);
    const facadeToolNames = serverNames.flatMap((server) =>
      toolNamesFor(server, STAGEHAND_FACADE_MCP_TOOLS),
    );
    const recorder = runtime.running.captureEvidence
      ? new ObservationRecorder(runtime.running.captureEvidence)
      : undefined;
    const capturedRoot = root;
    let cleanupPromise: Promise<void> | undefined;
    input.logger.log({
      category: "mastracode",
      message: `Initialized ${toolSurface} MCP mount for mastracode (servers: ${serverNames.join(", ")}).`,
      level: 2,
      auxiliary: {
        startupProfile: { value: startupProfile, type: "string" },
        environment: { value: input.environment, type: "string" },
      },
    });
    return {
      toolSurface,
      startupProfile,
      paths,
      env: buildMastracodeDriverEnv(paths),
      mcpServers,
      facadeToolNames,
      promptInstructions: mount.promptInstructions,
      browserSession: runtime.browserSession,
      ...(runtime.running.browserSessionLoss && {
        browserSessionLoss: runtime.running.browserSessionLoss,
      }),
      ...(runtime.running.captureEvidence && {
        captureEvidence: boundedCaptureEvidence(runtime.running.captureEvidence),
      }),
      ...(recorder && {
        drainStepObservations: async () => {
          await recorder.settle();
          return recorder.drain();
        },
        recordObservation: () => void recorder.record(),
      }),
      observedToolMatcher: mastraToolNameMatcher(serverNames),
      cleanup: async () => {
        cleanupPromise ??= (async () => {
          try {
            await cleanupRuntime(() => runtime.cleanup(), input.logger);
          } finally {
            await fsp.rm(capturedRoot, { recursive: true, force: true });
          }
        })();
        await cleanupPromise;
      },
    };
  } catch (error) {
    try {
      await cleanupRuntime(() => runtime.cleanup(), input.logger);
    } finally {
      if (root) await fsp.rm(root, { recursive: true, force: true });
    }
    throw error;
  }
}

export async function cleanupRuntime(
  cleanup: () => Promise<void>,
  logger: EvalLogger,
): Promise<void> {
  try {
    await withTimeout(
      cleanup(),
      readPositiveIntEnv("EVAL_AGENT_MOUNT_CLEANUP_TIMEOUT_MS", 30_000),
      "mastracode adapter cleanup",
    );
  } catch (error) {
    const message = sanitizeErrorMessage(
      error instanceof Error ? error.message : String(error),
    ).replace(/\b((?:apiKey|api_key|token|key)=)[^&\s"']+/giu, "$1[redacted]");
    logger.warn({
      category: "mastracode",
      message: `mastracode adapter cleanup failed: ${message}`,
      level: 0,
      auxiliary: { error: { value: message, type: "string" } },
    });
  }
}

function boundedCaptureEvidence(
  capture: () => Promise<ProbeEvidence>,
): () => Promise<ProbeEvidence> {
  return async () => {
    try {
      return await withTimeout(
        capture(),
        readPositiveIntEnv("EVAL_CAPTURE_EVIDENCE_TIMEOUT_MS", 15_000),
        "mastracode evidence capture",
      );
    } catch {
      return {};
    }
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function readPositiveIntEnv(key: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[key] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === "string");
}
