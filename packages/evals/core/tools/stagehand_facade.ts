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
 * The facade process and its browser are spawned by the agent harness. This
 * placeholder satisfies the CoreTool lifecycle contract without launching a
 * second, unobservable browser solely for the runner-side session.
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

  async start(input: ToolStartInput): Promise<ToolStartResult> {
    const expectedProfile =
      input.environment === "BROWSERBASE" ? "tool_create_browserbase" : "tool_launch_local";
    if (input.startupProfile !== expectedProfile) {
      throw new StagehandFacadeToolError(
        "stagehand_facade received an invalid startup profile for the selected environment.",
      );
    }

    const session = new StagehandFacadeMountSession();
    return {
      session,
      agentMount: {
        via: "mcp",
        promptInstructions: FACADE_AGENT_INSTRUCTIONS,
        mcpServers: {
          stagehand: {
            command: process.execPath,
            args: [serverPath],
            env: buildStagehandFacadeEnv(input.environment),
          },
        },
      },
      // Best-effort only: the facade stdio child (and the browser it owns)
      // is spawned by the agent harness, so this cleanup cannot reap it. If
      // the harness dies without killing its process tree, the child leaks
      // until it exits on its own (Browserbase session TTL bounds the remote
      // case).
      cleanup: async () => {
        await session.close();
      },
      metadata: {
        environment: input.environment === "BROWSERBASE" ? "browserbase" : "local",
        browserOwnership: "tool",
        connectionMode: connectionModeFromProfile(input.startupProfile),
        startupProfile: input.startupProfile,
      },
    };
  }
}
