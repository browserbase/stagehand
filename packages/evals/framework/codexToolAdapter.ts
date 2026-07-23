import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EvalsError } from "../errors.js";
import type { EvalLogger } from "../logger.js";
import {
  LLM_RUN_TOOL_NAME,
  type StartupProfile,
  type TerminalArtifact,
  type ToolSurface,
} from "../core/contracts/tool.js";
import { prepareLLMExposure as prepareCdpCodeLLMExposure } from "../core/tools/cdp_code.js";
import { prepareLLMExposure as preparePlaywrightCodeLLMExposure } from "../core/tools/playwright_code.js";
import { prepareLLMExposure as prepareV4CodeLLMExposure } from "../core/tools/v4_code.js";
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
  /** Harness-observed terminal state for artifact-grounded grading. */
  captureFinalState?: () => Promise<TerminalArtifact>;
  cleanup: () => Promise<void>;
}

export type PreparedCodexToolAdapter =
  | PreparedBrowseCliHarnessAdapter
  | PreparedCodexCodeAdapter;

const CODE_SURFACES = new Set<ToolSurface>([
  "v4_code",
  "playwright_code",
  "cdp_code",
]);

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

  const prepareSurfaceExposure =
    toolSurface === "playwright_code"
      ? preparePlaywrightCodeLLMExposure
      : toolSurface === "cdp_code"
        ? prepareCdpCodeLLMExposure
        : prepareV4CodeLLMExposure;
  const exposure = await prepareSurfaceExposure(
    input.plan,
    input.environment,
    input.logger,
    startupProfile,
  );

  let cwd: string | undefined;
  let bridge: Awaited<ReturnType<typeof startCodeBridge>> | undefined;
  try {
    if (exposure.kind !== "code_handles" || !exposure.handles) {
      throw new EvalsError(
        `Codex code mounting requires a code_handles exposure with handles; "${toolSurface}" returned kind "${exposure.kind}".`,
      );
    }
    bridge = await startCodeBridge({
      exposure,
      plan: input.plan,
      logger: input.logger,
    });
    cwd = await fsp.mkdtemp(
      path.join(
        os.tmpdir(),
        `stagehand-evals-codex-${toolSurface.replace(/_/g, "-")}-`,
      ),
    );
    await fsp.writeFile(
      path.join(cwd, "browser_run.mjs"),
      buildBridgeClientScript(bridge.port),
    );

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
      promptInstructions: buildCodexCodePromptInstructions(
        exposure,
        toolSurface,
      ),
      ...(exposure.captureFinalState && {
        captureFinalState: exposure.captureFinalState,
      }),
      cleanup: async () => {
        try {
          await capturedBridge.close();
        } catch {
          // best-effort only
        }
        try {
          await exposure.cleanup();
        } catch {
          // best-effort only
        }
        await fsp.rm(capturedCwd, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await bridge?.close().catch((): undefined => undefined);
    await exposure.cleanup().catch((): undefined => undefined);
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
  exposure: { promptInstructions: string; handles?: Record<string, unknown> },
  toolSurface: ToolSurface,
): string {
  const scopeNames = [
    ...Object.keys(exposure.handles ?? {}),
    "startUrl",
    "task",
    "console",
  ].join(", ");
  const surfaceGuidance = exposure.promptInstructions.replaceAll(
    LLM_RUN_TOOL_NAME,
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
    `Codex harness supports --tool browse_cli, playwright_code, cdp_code, or v4_code for execution right now; received "${requested}".`,
  );
}

export function resolveCodexStartupProfile(
  toolSurface: ToolSurface,
  environment: "LOCAL" | "BROWSERBASE",
  requested?: StartupProfile,
): StartupProfile {
  if (requested) return requested;

  // browse_cli and v4_code own their browser; playwright/cdp attach to a
  // runner-provided CDP endpoint (same defaults as the claude_code harness).
  if (toolSurface === "browse_cli" || toolSurface === "v4_code") {
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
    `No Codex startup profile default for tool "${toolSurface}" in ${environment}.`,
  );
}
