import {
  explicitSnapshotActionsEnabled,
  facadeAgentInstructions,
  LEGACY_FACADE_AGENT_INSTRUCTIONS,
} from "@browserbasehq/stagehand-integrations/facade";
import {
  buildAllowlistedEnv,
  sanitizeErrorMessage,
} from "@browserbasehq/stagehand-integrations/harness";
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
import { acquireRunScopedStagehandExtension } from "../targets/browserbase.js";
import {
  evalBooleanEnv,
  evalBrowserbaseSessionTimeoutSeconds,
} from "../targets/browserbaseSessionOptions.js";

export {
  DEFAULT_EVAL_BROWSERBASE_SESSION_TIMEOUT_SECONDS,
  evalBooleanEnv,
  evalBrowserbaseSessionTimeoutSeconds,
} from "../targets/browserbaseSessionOptions.js";

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
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  return {
    ...buildAllowlistedEnv(env),
    STAGEHAND_BROWSER: environment === "BROWSERBASE" ? "browserbase" : "local",
    ...(explicitSnapshotActionsEnabled(env) && { EXPLICIT_SNAPSHOT_ACTIONS: "1" }),
    ...(environment === "BROWSERBASE" && {
      STAGEHAND_BROWSERBASE_SESSION_TIMEOUT_SECONDS: String(
        evalBrowserbaseSessionTimeoutSeconds(env.EVAL_BROWSERBASE_SESSION_TIMEOUT_SECONDS),
      ),
      STAGEHAND_BROWSERBASE_PROXIES: evalBooleanEnv(env.EVAL_BROWSERBASE_PROXIES, true) ? "1" : "0",
      STAGEHAND_BROWSERBASE_VERIFIED: evalBooleanEnv(env.EVAL_BROWSERBASE_VERIFIED, true)
        ? "1"
        : "0",
    }),
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
      sharedExtension?:
        | false
        | (() => Promise<{ extensionId: string; release: () => Promise<void> } | undefined>);
    } = {},
  ) {}

  protected defaultServerSpec(environment: ToolStartInput["environment"]) {
    return buildStagehandFacadeServerSpec(environment);
  }

  protected promptInstructions(): string {
    return facadeAgentInstructions();
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
    let sharedExtension: { extensionId: string; release: () => Promise<void> } | undefined;
    if (input.environment === "BROWSERBASE" && this.options.sharedExtension !== false) {
      try {
        sharedExtension = await (
          this.options.sharedExtension ?? acquireRunScopedStagehandExtension
        )();
      } catch (error) {
        input.logger?.warn?.({
          category: "stagehand_facade",
          level: 1,
          message: `Shared Stagehand extension unavailable; the facade will upload its own: ${sanitizeErrorMessage(
            error instanceof Error ? error.message : String(error),
          )}`,
        });
      }
    }
    if (sharedExtension) {
      spec.env = { ...spec.env, STAGEHAND_BROWSERBASE_EXTENSION_ID: sharedExtension.extensionId };
    }
    let bridge: Awaited<ReturnType<typeof startStagehandFacadeBridge>>;
    try {
      bridge = await startStagehandFacadeBridge({ server: spec, logger: input.logger });
    } catch (error) {
      await sharedExtension?.release().catch((): undefined => undefined);
      throw error;
    }
    if (typeof input.logger?.log === "function") {
      input.logger.log({
        category: "stagehand_facade",
        level: 2,
        message: `Started runner-owned ${this.id} bridge on 127.0.0.1:${bridge.port}.`,
      });
    }
    let browserSession: Record<string, unknown> = {};
    try {
      const info = input.environment === "BROWSERBASE" ? await bridge.sessionInfo() : undefined;
      browserSession = info?.sessionId
        ? {
            browserbaseSessionId: info.sessionId,
            browserbaseSessionUrl: `https://www.browserbase.com/sessions/${encodeURIComponent(info.sessionId)}`,
          }
        : {};
    } catch (error) {
      if (typeof input.logger?.warn === "function") {
        input.logger.warn({
          category: "stagehand_facade",
          level: 1,
          message: `Could not resolve the facade browser session up front: ${sanitizeErrorMessage(
            error instanceof Error ? error.message : String(error),
          )}`,
        });
      }
    }
    let cleanupPromise: Promise<void> | undefined;
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
      callTool: (name, args, options) => bridge.callTool(name, args, options),
      browserSessionLoss: () => bridge.browserSessionLoss(),
      cleanup: () =>
        (cleanupPromise ??= (async () => {
          const failures: unknown[] = [];
          for (const close of [
            () => bridge.close(),
            () => session.close(),
            () => sharedExtension?.release(),
          ]) {
            try {
              await close();
            } catch (error) {
              failures.push(error);
            }
          }
          if (failures.length) {
            throw new StagehandFacadeToolError("Failed to clean up the Stagehand facade.", {
              cause: new AggregateError(failures, "Facade cleanup failures"),
            });
          }
        })()),
      metadata: {
        environment: input.environment === "BROWSERBASE" ? "browserbase" : "local",
        browserOwnership: "tool",
        connectionMode: connectionModeFromProfile(input.startupProfile),
        startupProfile: input.startupProfile,
        promptVariant: explicitSnapshotActionsEnabled() ? "explicit_snapshot_actions" : "default",
        facadeBridgePort: bridge.port,
        ...browserSession,
      },
    };
  }
}

export class StagehandFacadeLegacyTool extends StagehandFacadeTool {
  override readonly id: ToolSurface = "stagehand_facade_legacy";

  protected override defaultServerSpec(environment: ToolStartInput["environment"]) {
    return buildStagehandFacadeLegacyServerSpec(environment);
  }

  protected override promptInstructions(): string {
    return LEGACY_FACADE_AGENT_INSTRUCTIONS;
  }
}

export class AnthropicBrowserToolsetTool extends StagehandFacadeTool {
  override readonly id: ToolSurface = "anthropic_browser_toolset";
}

export class GoogleComputerUseTool extends StagehandFacadeTool {
  override readonly id: ToolSurface = "google_computer_use";
}
