import { FACADE_AGENT_INSTRUCTIONS } from "@browserbasehq/stagehand-integrations/facade";
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

export function buildStagehandFacadeEnv(
  environment: ToolStartInput["environment"],
): Record<string, string> {
  return {
    ...buildAllowlistedEnv(),
    STAGEHAND_BROWSER: environment === "BROWSERBASE" ? "browserbase" : "local",
  };
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

function connectionModeFromProfile(startupProfile: StartupProfile): ConnectionMode {
  return startupProfile === "tool_create_browserbase" ? "browserbase_native" : "launch";
}

export class StagehandFacadeTool implements CoreTool {
  readonly id = "stagehand_facade";
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

  async start(input: ToolStartInput): Promise<ToolStartResult> {
    const expectedProfile =
      input.environment === "BROWSERBASE" ? "tool_create_browserbase" : "tool_launch_local";
    if (input.startupProfile !== expectedProfile) {
      throw new StagehandFacadeToolError(
        "stagehand_facade received an invalid startup profile for the selected environment.",
      );
    }

    const session = new StagehandFacadeMountSession();
    const spec = (this.options.serverSpec ?? buildStagehandFacadeServerSpec)(input.environment);
    const bridge = await startStagehandFacadeBridge({ server: spec, logger: input.logger });
    if (typeof input.logger?.log === "function") {
      input.logger.log({
        category: "stagehand_facade",
        level: 1,
        message: `Started runner-owned stagehand_facade bridge on 127.0.0.1:${bridge.port}.`,
      });
    }
    return {
      session,
      agentMount: {
        via: "mcp",
        promptInstructions: FACADE_AGENT_INSTRUCTIONS,
        mcpServers: {
          stagehand: bridge.mcpServerSpec,
        },
      },
      captureEvidence: () => bridge.captureEvidence(),
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
      },
    };
  }
}
