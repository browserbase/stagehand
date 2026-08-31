import {
  FACADE_AGENT_INSTRUCTIONS,
  LEGACY_FACADE_AGENT_INSTRUCTIONS,
} from "@browserbasehq/stagehand-integrations/facade";
import { buildAllowlistedEnv } from "@browserbasehq/stagehand-integrations/harness";
import { fileURLToPath } from "node:url";
import { EvalsError } from "../../errors.js";
import type { Artifact, ConnectionMode } from "../contracts/results.js";
import type {
  CoreCapability,
  CorePageHandle,
  CoreSession,
  CoreTool,
  StartupProfile,
  ToolStartInput,
  ToolStartResult,
  ToolSurface,
} from "../contracts/tool.js";
import type { TargetKind } from "../contracts/targets.js";
import { startStagehandFacadeBridge } from "./stagehandFacadeBridge.js";

export class StagehandFacadeToolError extends EvalsError {
  override readonly name = "StagehandFacadeToolError";
}

const SUPPORTED_CAPABILITIES: CoreCapability[] = [
  "session",
  "navigation",
  "evaluation",
  "screenshot",
  "viewport",
  "wait",
  "click",
  "hover",
  "scroll",
  "type",
  "press",
  "tabs",
  "representation",
];

const serverPath = fileURLToPath(
  import.meta.resolve("@browserbasehq/stagehand-integrations/facade/stdio-server"),
);

function unsupportedSessionOperation(): never {
  throw new StagehandFacadeToolError(
    "stagehand_facade is available only through its agent MCP mount.",
  );
}

/**
 * The facade process and its browser are owned by the runner-side bridge, but
 * there is still no runner-driven CoreSession. This placeholder satisfies the
 * lifecycle contract while agents and evidence probes share the MCP browser.
 */
class StagehandFacadeMountSession implements CoreSession {
  async listPages(): Promise<CorePageHandle[]> {
    return unsupportedSessionOperation();
  }

  async activePage(): Promise<CorePageHandle> {
    return unsupportedSessionOperation();
  }

  async newPage(): Promise<CorePageHandle> {
    return unsupportedSessionOperation();
  }

  async selectPage(): Promise<void> {
    unsupportedSessionOperation();
  }

  async closePage(): Promise<void> {
    unsupportedSessionOperation();
  }

  async close(): Promise<void> {}

  async getArtifacts(): Promise<Artifact[]> {
    return [];
  }

  async getRawMetrics(): Promise<Record<string, unknown>> {
    return {};
  }
}

/**
 * Browserbase's project default session timeout (15 min) is shorter than many
 * benchmark tasks; the facade session must outlive the agent, so every harness
 * gets an explicit one. Seconds, mirroring the Browserbase API.
 */
export const DEFAULT_EVAL_BROWSERBASE_SESSION_TIMEOUT_SECONDS = 3600;
const MAX_BROWSERBASE_SESSION_TIMEOUT_SECONDS = 21_600;

export function buildStagehandFacadeEnv(
  environment: ToolStartInput["environment"],
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  return {
    ...buildAllowlistedEnv(),
    STAGEHAND_BROWSER: environment === "BROWSERBASE" ? "browserbase" : "local",
    ...(environment === "BROWSERBASE" && {
      STAGEHAND_BROWSERBASE_SESSION_TIMEOUT_SECONDS: String(
        evalBrowserbaseSessionTimeoutSeconds(env.EVAL_BROWSERBASE_SESSION_TIMEOUT_SECONDS),
      ),
    }),
  };
}

export function evalBrowserbaseSessionTimeoutSeconds(raw: string | undefined): number {
  const value = raw?.trim();
  if (!value) return DEFAULT_EVAL_BROWSERBASE_SESSION_TIMEOUT_SECONDS;
  const parsed = Number(value);
  if (
    !/^\d+$/u.test(value) ||
    !Number.isSafeInteger(parsed) ||
    parsed <= 0 ||
    parsed > MAX_BROWSERBASE_SESSION_TIMEOUT_SECONDS
  ) {
    throw new StagehandFacadeToolError(
      `EVAL_BROWSERBASE_SESSION_TIMEOUT_SECONDS must be a positive integer of at most ${MAX_BROWSERBASE_SESSION_TIMEOUT_SECONDS} seconds (got "${value}").`,
    );
  }
  return parsed;
}

export function buildStagehandFacadeServerSpec(environment: ToolStartInput["environment"]): {
  command: string;
  args: string[];
  env: Record<string, string>;
} {
  return {
    command: process.execPath,
    args: [serverPath],
    env: buildStagehandFacadeEnv(environment),
  };
}

/** Same facade server, started with `--surface=legacy` so it advertises the pre-Playwright-idiom run contract. */
export function buildStagehandFacadeLegacyServerSpec(environment: ToolStartInput["environment"]): {
  command: string;
  args: string[];
  env: Record<string, string>;
} {
  const spec = buildStagehandFacadeServerSpec(environment);
  return { ...spec, args: [...spec.args, "--surface=legacy"] };
}

function connectionModeFromProfile(startupProfile: StartupProfile): ConnectionMode {
  return startupProfile === "tool_create_browserbase" ? "browserbase_native" : "launch";
}

export class StagehandFacadeTool implements CoreTool {
  readonly id: ToolSurface = "stagehand_facade";
  readonly surface = "mcp";
  readonly family = "stagehand";
  readonly supportedStartupProfiles: StartupProfile[] = [
    "tool_launch_local",
    "tool_create_browserbase",
  ];
  readonly supportedCapabilities: CoreCapability[] = [...SUPPORTED_CAPABILITIES];
  readonly supportedTargetKinds: TargetKind[] = ["selector", "coords", "focused", "snapshot_ref"];

  constructor(
    private readonly options: {
      serverSpec?: (environment: ToolStartInput["environment"]) => {
        command: string;
        args: string[];
        env: Record<string, string>;
      };
    } = {},
  ) {}

  protected defaultServerSpec(environment: ToolStartInput["environment"]) {
    return buildStagehandFacadeServerSpec(environment);
  }

  protected promptInstructions(): string {
    return FACADE_AGENT_INSTRUCTIONS;
  }

  async start(input: ToolStartInput): Promise<ToolStartResult> {
    const expectedProfile =
      input.environment === "BROWSERBASE" ? "tool_create_browserbase" : "tool_launch_local";
    if (input.startupProfile !== expectedProfile) {
      throw new StagehandFacadeToolError(
        `${this.id} received an invalid startup profile for the selected environment.`,
      );
    }

    const session = new StagehandFacadeMountSession();
    const spec = this.options.serverSpec
      ? this.options.serverSpec(input.environment)
      : this.defaultServerSpec(input.environment);
    const bridge = await startStagehandFacadeBridge({ server: spec, logger: input.logger });
    if (typeof input.logger?.log === "function") {
      input.logger.log({
        category: "stagehand_facade",
        level: 2,
        message: `Started runner-owned ${this.id} bridge on 127.0.0.1:${bridge.port}.`,
      });
    }
    // Launch the Browserbase browser now rather than on the agent's first call
    // so the session id is known before the agent starts. Local browsers have
    // nothing to report and keep their lazy launch.
    let browserSession: Record<string, unknown> = {};
    try {
      const info = input.environment === "BROWSERBASE" ? await bridge.sessionInfo() : undefined;
      browserSession = info?.sessionId
        ? {
            browserbaseSessionId: info.sessionId,
            browserbaseSessionUrl: `https://www.browserbase.com/sessions/${info.sessionId}`,
          }
        : {};
    } catch (error) {
      if (typeof input.logger?.warn === "function") {
        input.logger.warn({
          category: "stagehand_facade",
          level: 1,
          message: `Could not resolve the facade browser session up front: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      }
    }
    return {
      session,
      agentMount: {
        via: "mcp",
        promptInstructions: this.promptInstructions(),
        mcpServers: {
          stagehand: bridge.mcpServerSpec,
        },
      },
      captureEvidence: () => bridge.captureEvidence(),
      browserSessionLoss: () => bridge.browserSessionLoss(),
      cleanup: async () => {
        await bridge.close();
        await session.close();
      },
      metadata: {
        environment: input.environment === "BROWSERBASE" ? "browserbase" : "local",
        browserOwnership: "tool",
        connectionMode: connectionModeFromProfile(input.startupProfile),
        startupProfile: input.startupProfile,
        facadeBridgePort: bridge.port,
        ...browserSession,
      },
    };
  }
}

/**
 * The facade surface as it shipped before the Playwright-idiom prompt: same
 * server, same snapshot/screenshot tools, but the earlier run description and
 * agent instructions. Kept under its own id so trajectories from the two
 * prompts are never compared as one surface.
 */
export class StagehandFacadeLegacyTool extends StagehandFacadeTool {
  override readonly id: ToolSurface = "stagehand_facade_legacy";

  protected override defaultServerSpec(environment: ToolStartInput["environment"]) {
    return buildStagehandFacadeLegacyServerSpec(environment);
  }

  protected override promptInstructions(): string {
    return LEGACY_FACADE_AGENT_INSTRUCTIONS;
  }
}
