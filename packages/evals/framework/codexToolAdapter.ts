import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EvalsError } from "../errors.js";
import type { EvalLogger } from "../logger.js";
import {
  AGENT_RUN_TOOL_NAME,
  type StartupProfile,
  type ToolSurface,
} from "../core/contracts/tool.js";
import type { ProbeEvidence } from "stagehand-v3";
import { startAgentToolRuntime } from "./agentToolRuntime.js";
import type { ExternalHarnessTaskPlan } from "./externalHarnessPlan.js";
import { buildBridgeClientScript, startCodeBridge } from "./codexCodeBridge.js";
import {
  prepareBrowseCliHarnessAdapter,
  type PreparedBrowseCliHarnessAdapter,
} from "./claudeCodeToolAdapter.js";

export interface CodexToolAdapterInput {
  toolSurface?: ToolSurface;
  startupProfile?: StartupProfile;
  environment: "LOCAL" | "BROWSERBASE";
  plan: ExternalHarnessTaskPlan;
  logger: EvalLogger;
}

/** Code-surface variant: same runner-facing fields as the browse_cli shape. */
export interface PreparedCodexCodeAdapter {
  toolSurface: ToolSurface;
  startupProfile: StartupProfile;
  cwd: string;
  env: Record<string, string>;
  promptInstructions: string;
  /** Best-effort evidence from the currently running tool surface. */
  captureEvidence?: () => Promise<ProbeEvidence>;
  cleanup: () => Promise<void>;
}

export type PreparedCodexToolAdapter = PreparedBrowseCliHarnessAdapter | PreparedCodexCodeAdapter;

const CODE_SURFACES = new Set<ToolSurface>(["stagehand_code", "playwright_code", "cdp_code"]);

export async function prepareCodexToolAdapter(
  input: CodexToolAdapterInput,
): Promise<PreparedCodexToolAdapter> {
  const toolSurface = resolveCodexToolSurface(input.toolSurface);
  const startupProfile = resolveCodexStartupProfile(
    toolSurface,
    input.environment,
    input.startupProfile,
  );

  if (toolSurface === "browse_cli") {
    return prepareBrowseCliHarnessAdapter({
      startupProfile,
      environment: input.environment,
      plan: input.plan,
      logger: input.logger,
      logCategory: "codex",
    });
  }

  const runtime = await startAgentToolRuntime({
    toolSurface,
    startupProfile,
    environment: input.environment,
    logger: input.logger,
  });

  let cwd: string | undefined;
  let bridge: Awaited<ReturnType<typeof startCodeBridge>> | undefined;
  try {
    const mount = runtime.running.agentMount;
    if (!mount) {
      throw new EvalsError(`Tool surface "${toolSurface}" does not provide an agent mount.`);
    }
    if (mount.via !== "handles") {
      throw new EvalsError(`Codex does not support agent mounts delivered via "${mount.via}" yet.`);
    }
    bridge = await startCodeBridge({
      mount,
      plan: input.plan,
      logger: input.logger,
    });
    cwd = await fsp.mkdtemp(
      path.join(os.tmpdir(), `stagehand-evals-codex-${toolSurface.replace(/_/g, "-")}-`),
    );
    await fsp.writeFile(path.join(cwd, "browser_run.mjs"), buildBridgeClientScript(bridge.port));

    input.logger.log({
      category: "codex",
      message: `Initialized ${toolSurface} bridge runtime for Codex (port ${bridge.port}).`,
      level: 1,
      auxiliary: {
        startupProfile: { value: startupProfile, type: "string" },
        environment: { value: input.environment, type: "string" },
      },
    });

    const capturedBridge = bridge;
    const capturedCwd = cwd;
    return {
      toolSurface,
      startupProfile,
      cwd,
      env: { ...process.env } as Record<string, string>,
      promptInstructions: buildCodexCodePromptInstructions(mount, toolSurface),
      ...(runtime.running.captureEvidence && {
        captureEvidence: runtime.running.captureEvidence,
      }),
      cleanup: async () => {
        try {
          await capturedBridge.close();
        } catch {
          // best-effort only
        }
        try {
          await runtime.cleanup();
        } catch {
          // best-effort only
        }
        await fsp.rm(capturedCwd, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await bridge?.close().catch((): undefined => undefined);
    await runtime.cleanup().catch((): undefined => undefined);
    if (cwd) await fsp.rm(cwd, { recursive: true, force: true });
    throw error;
  }
}

/**
 * Codex has no MCP run tool — snippets go through the workspace bridge
 * client. Reuse the surface's own API guidance, rewriting the claude-style
 * run-tool reference to the codex invocation.
 */
function buildCodexCodePromptInstructions(
  mount: { promptInstructions: string; handles: Record<string, unknown> },
  toolSurface: ToolSurface,
): string {
  const scopeNames = [...Object.keys(mount.handles), "startUrl", "task", "console"].join(", ");
  const surfaceGuidance = mount.promptInstructions.replaceAll(
    AGENT_RUN_TOOL_NAME,
    "browser_run.mjs",
  );
  return [
    `Browser automation for this task runs through a snippet bridge, not a browser you launch.`,
    `Write a JavaScript snippet to a file (e.g. snippet.js), then execute it with: node browser_run.mjs snippet.js`,
    `The snippet runs inside an async function with ${scopeNames} in scope. Use await directly; return a JSON-serializable value to inspect it.`,
    `Never launch your own browser process; browser_run.mjs is the only browser access.`,
    surfaceGuidance,
    `Surface: ${toolSurface}.`,
  ].join("\n");
}

export function resolveCodexToolSurface(requested?: ToolSurface): ToolSurface {
  if (!requested) return "browse_cli";
  if (requested === "browse_cli" || CODE_SURFACES.has(requested)) {
    return requested;
  }
  throw new EvalsError(
    `Codex harness supports --tool browse_cli, playwright_code, cdp_code, or stagehand_code for execution right now; received "${requested}".`,
  );
}

export function resolveCodexStartupProfile(
  toolSurface: ToolSurface,
  environment: "LOCAL" | "BROWSERBASE",
  requested?: StartupProfile,
): StartupProfile {
  if (requested) return requested;

  // browse_cli and stagehand_code own their browser; playwright/cdp attach to a
  // runner-provided CDP endpoint (same defaults as the claude_code harness).
  if (toolSurface === "browse_cli" || toolSurface === "stagehand_code") {
    return environment === "BROWSERBASE" ? "tool_create_browserbase" : "tool_launch_local";
  }
  if (toolSurface === "playwright_code" || toolSurface === "cdp_code") {
    return environment === "BROWSERBASE"
      ? "runner_provided_browserbase_cdp"
      : "runner_provided_local_cdp";
  }

  throw new EvalsError(
    `No Codex startup profile default for tool "${toolSurface}" in ${environment}.`,
  );
}
