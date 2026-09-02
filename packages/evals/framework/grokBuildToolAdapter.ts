import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { stringify } from "smol-toml";
import type { ProbeEvidence } from "stagehand-v3";
import type { StartupProfile, ToolSurface } from "../core/contracts/tool.js";
import { EvalsError } from "../errors.js";
import type { EvalLogger } from "../logger.js";
import { startAgentToolRuntime } from "./agentToolRuntime.js";
import type { ExternalHarnessTaskPlan } from "./externalHarnessPlan.js";
import { resolveStartupProfile, resolveToolSurface } from "./harnesses/toolSurfaceResolution.js";
import { ObservationRecorder, type StepObservation } from "./observationRecorder.js";

export interface GrokBuildToolAdapterInput {
  toolSurface?: ToolSurface;
  startupProfile?: StartupProfile;
  environment: "LOCAL" | "BROWSERBASE";
  plan: ExternalHarnessTaskPlan;
  logger: EvalLogger;
}

export interface PreparedGrokBuildToolAdapter {
  toolSurface: ToolSurface;
  startupProfile: StartupProfile;
  cwd: string;
  home: string;
  grokHome: string;
  env: Record<string, string>;
  mcpConfigPath: string;
  mcpServerNames: string[];
  promptInstructions: string;
  captureEvidence?: () => Promise<ProbeEvidence>;
  drainStepObservations?: () => Promise<StepObservation[]>;
  onToolResult?: (toolName: string) => void;
  observedToolMatcher?: (name: string) => boolean;
  cleanup: () => Promise<void>;
}

type GrokBuildMcpServerSpec = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

export const GROK_BUILD_TOOL_SURFACES: ToolSurface[] = [
  "stagehand_facade",
  "playwright_mcp",
  "chrome_devtools_mcp",
];

export function buildGrokBuildMcpConfig(
  mcpServers: Record<string, unknown>,
): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const [serverName, rawSpec] of Object.entries(mcpServers)) {
    if (!isRecord(rawSpec) || typeof rawSpec.command !== "string") {
      throw new EvalsError(`Invalid Grok Build MCP launch spec for server "${serverName}".`);
    }
    const spec = rawSpec as GrokBuildMcpServerSpec;
    normalized[serverName] = {
      command: spec.command,
      args: stringArray(spec.args),
      ...(isStringRecord(spec.env) && { env: spec.env }),
      startup_timeout_sec: 60,
      tool_timeout_sec: 300,
    };
  }
  return { mcp_servers: normalized };
}

export async function writeGrokBuildWorkspace(
  cwd: string,
  grokHome: string,
  mcpServers: Record<string, unknown>,
): Promise<{ mcpConfigPath: string }> {
  const projectConfigDir = path.join(cwd, ".grok");
  const mcpConfigPath = path.join(projectConfigDir, "config.toml");
  await Promise.all([
    fsp.mkdir(projectConfigDir, { recursive: true }),
    fsp.mkdir(grokHome, { recursive: true }),
  ]);
  await Promise.all([
    fsp.writeFile(
      path.join(grokHome, "config.toml"),
      stringify({
        cli: { auto_update: false, use_leader: false },
        compat: { claude: { mcps: false }, cursor: { mcps: false } },
        subagents: { enabled: false },
        memory: { enabled: false },
      }),
      { mode: 0o600 },
    ),
    fsp.writeFile(mcpConfigPath, stringify(buildGrokBuildMcpConfig(mcpServers)), {
      mode: 0o600,
    }),
  ]);
  return { mcpConfigPath };
}

export function resolveGrokBuildAuthHome(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  const configured = env.GROK_HOME?.trim();
  if (configured) return configured;
  const userHome =
    platform === "win32"
      ? env.USERPROFILE?.trim() || env.HOME?.trim()
      : env.HOME?.trim() || env.USERPROFILE?.trim();
  return userHome ? path.join(userHome, ".grok") : undefined;
}

export async function copyGrokBuildAuth(
  env: NodeJS.ProcessEnv,
  targetGrokHome: string,
): Promise<boolean> {
  if (env.XAI_API_KEY?.trim()) return false;
  const sourceHome = resolveGrokBuildAuthHome(env);
  if (!sourceHome) return false;
  try {
    await fsp.copyFile(path.join(sourceHome, "auth.json"), path.join(targetGrokHome, "auth.json"));
    return true;
  } catch {
    return false;
  }
}

export function isGrokBuildMountToolName(serverNames: string[], toolName: string): boolean {
  return serverNames.some(
    (server) =>
      toolName === server ||
      toolName.startsWith(`${server}.`) ||
      toolName.startsWith(`${server}__`) ||
      toolName === `mcp__${server}` ||
      toolName.startsWith(`mcp__${server}__`),
  );
}

export async function prepareGrokBuildToolAdapter(
  input: GrokBuildToolAdapterInput,
): Promise<PreparedGrokBuildToolAdapter> {
  const toolSurface = resolveToolSurface(
    { harness: "grok_build", supportedToolSurfaces: GROK_BUILD_TOOL_SURFACES },
    input.toolSurface,
  );
  if (toolSurface === undefined) {
    throw new EvalsError("grok_build harness requires a tool surface.");
  }
  const startupProfile = resolveStartupProfile(
    toolSurface,
    input.environment,
    input.startupProfile,
  );
  const runtime = await startAgentToolRuntime({
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
        `Grok Build does not support agent mounts delivered via "${mount.via}" yet.`,
      );
    }

    root = await fsp.mkdtemp(
      path.join(os.tmpdir(), `stagehand-evals-grok-build-${toolSurface.replace(/_/gu, "-")}-`),
    );
    const capturedRoot = root;
    const home = path.join(root, "home");
    const cwd = path.join(root, "workspace");
    const grokHome = path.join(home, ".grok");
    await Promise.all([
      fsp.mkdir(cwd, { recursive: true }),
      fsp.mkdir(grokHome, { recursive: true }),
    ]);
    await copyGrokBuildAuth(process.env, grokHome);
    const { mcpConfigPath } = await writeGrokBuildWorkspace(cwd, grokHome, mount.mcpServers);
    const mcpServerNames = Object.keys(mount.mcpServers);
    const recorder = runtime.running.captureEvidence
      ? new ObservationRecorder(runtime.running.captureEvidence)
      : undefined;
    const observedToolMatcher = (name: string): boolean =>
      isGrokBuildMountToolName(mcpServerNames, name);
    let cleanupPromise: Promise<void> | undefined;

    input.logger.log({
      category: "grok_build",
      message: `Initialized ${toolSurface} MCP mount for Grok Build (servers: ${mcpServerNames.join(", ")}).`,
      level: 1,
      auxiliary: {
        startupProfile: { value: startupProfile, type: "string" },
        environment: { value: input.environment, type: "string" },
      },
    });

    return {
      toolSurface,
      startupProfile,
      cwd,
      home,
      grokHome,
      env: stringEnv({
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        GROK_HOME: grokHome,
      }),
      mcpConfigPath,
      mcpServerNames,
      promptInstructions: mount.promptInstructions,
      ...(runtime.running.captureEvidence && {
        captureEvidence: boundedCaptureEvidence(runtime.running.captureEvidence),
      }),
      ...(recorder && {
        drainStepObservations: async () => {
          await recorder.settle();
          return recorder.drain();
        },
        onToolResult: (toolName: string) => {
          if (observedToolMatcher(toolName)) void recorder.record();
        },
      }),
      observedToolMatcher,
      cleanup: async () => {
        cleanupPromise ??= (async () => {
          try {
            await withTimeout(
              runtime.cleanup(),
              readPositiveIntEnv("EVAL_AGENT_MOUNT_CLEANUP_TIMEOUT_MS", 30_000),
            );
          } catch {
            // Best effort only.
          } finally {
            await fsp.rm(capturedRoot, { recursive: true, force: true });
          }
        })();
        await cleanupPromise;
      },
    };
  } catch (error) {
    await withTimeout(
      runtime.cleanup(),
      readPositiveIntEnv("EVAL_AGENT_MOUNT_CLEANUP_TIMEOUT_MS", 30_000),
    ).catch((): undefined => undefined);
    if (root) await fsp.rm(root, { recursive: true, force: true });
    throw error;
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
      );
    } catch {
      return {};
    }
  };
}

function readPositiveIntEnv(key: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[key] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`grok_build adapter operation timed out after ${timeoutMs}ms`)),
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

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function stringEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
