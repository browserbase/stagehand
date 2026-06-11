import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type {
  CoreCapability,
  CoreTool,
  StartupProfile,
  ToolStartInput,
  ToolStartResult,
} from "../contracts/tool.js";
import type { TargetKind } from "../contracts/targets.js";
import { getRepoRootDir } from "../../runtimePaths.js";
import {
  CDP_CODE_SUPPORTED_CAPABILITIES,
  CdpSession,
  connectionModeFromProfile,
  type CdpConnectionLike,
  type CdpEventMessage,
} from "./cdp_code.js";

export type ModCDPClientLike = {
  connect(): Promise<unknown>;
  close(): Promise<void>;
  send<T = unknown>(method: string, params?: unknown): Promise<T>;
  on(
    eventName: string | symbol,
    listener: (...args: unknown[]) => void,
  ): unknown;
  off(
    eventName: string | symbol,
    listener: (...args: unknown[]) => void,
  ): unknown;
  _cdp: {
    send<T = unknown>(
      method: string,
      params?: Record<string, unknown>,
      sessionId?: string | null,
    ): Promise<T>;
  };
  [key: string]: unknown;
};

type ModCDPClientConstructor = new (
  options?: Record<string, unknown>,
) => ModCDPClientLike;

type ModCDPClientModule = {
  ModCDPClient: ModCDPClientConstructor;
};

const DEFAULT_STAGEHAND_V4_SDK_PATH = path.join(
  getRepoRootDir(),
  "..",
  "stagehand-driver",
  "sdks",
  "js",
  "index.ts",
);

const DEFAULT_MODCDP_CLIENT_PATH = path.join(
  path.dirname(DEFAULT_STAGEHAND_V4_SDK_PATH),
  "..",
  "..",
  "modcdp",
  "dist",
  "client",
  "js",
  "ModCDPClient.js",
);

export class ModCdpConnection implements CdpConnectionLike {
  readonly client: ModCDPClientLike;

  private constructor(client: ModCDPClientLike) {
    this.client = client;
  }

  static async connect(input: {
    kind: "ws" | "http";
    url: string;
  }): Promise<ModCdpConnection> {
    const stagehandV4SdkPath =
      process.env.STAGEHAND_V4_SDK_PATH ?? DEFAULT_STAGEHAND_V4_SDK_PATH;
    const stagehandV4RootPath = path.join(
      path.dirname(stagehandV4SdkPath),
      "..",
      "..",
    );
    const clientPath =
      process.env.MODCDP_CLIENT_PATH ??
      (process.env.STAGEHAND_V4_SDK_PATH
        ? path.join(
            stagehandV4RootPath,
            "modcdp",
            "dist",
            "client",
            "js",
            "ModCDPClient.js",
          )
        : DEFAULT_MODCDP_CLIENT_PATH);
    if (!fs.existsSync(clientPath)) {
      throw new Error(
        [
          "modcdp_code requires a built ModCDP JS client.",
          `Expected ModCDP client at: ${clientPath}`,
          "Set MODCDP_CLIENT_PATH to the ModCDPClient.js entrypoint if your checkout lives somewhere else.",
          `Or build it with: pnpm --dir ${stagehandV4RootPath} --filter modcdp run build`,
        ].join("\n"),
      );
    }

    const { ModCDPClient } = (await import(
      pathToFileURL(clientPath).href
    )) as ModCDPClientModule;
    const client = new ModCDPClient({
      cdp_url: input.url,
      routes: { "*.*": "service_worker" },
      server: {
        loopback_cdp_url: input.url,
        routes: { "*.*": "loopback_cdp" },
      },
    });
    await client.connect();
    return new ModCdpConnection(client);
  }

  onEvent(listener: (event: CdpEventMessage) => void): () => void {
    const wrapped = (
      method: unknown,
      params: unknown,
      sessionId: unknown,
    ): void => {
      if (typeof method !== "string") return;
      listener({
        method,
        params:
          params && typeof params === "object" && !Array.isArray(params)
            ? (params as Record<string, unknown>)
            : undefined,
        sessionId: typeof sessionId === "string" ? sessionId : undefined,
      });
    };
    this.client.on("*", wrapped);
    return () => {
      this.client.off("*", wrapped);
    };
  }

  async send<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string,
  ): Promise<T> {
    return this.client._cdp.send<T>(method, params, sessionId ?? null);
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}

export class ModCdpCodeTool implements CoreTool {
  readonly id = "modcdp_code";
  readonly surface = "code";
  readonly family = "cdp";
  readonly supportedStartupProfiles: StartupProfile[] = [
    "runner_provided_local_cdp",
    "runner_provided_browserbase_cdp",
    "tool_attach_local_cdp",
    "tool_attach_browserbase",
  ];
  readonly supportedCapabilities: CoreCapability[] = [
    ...CDP_CODE_SUPPORTED_CAPABILITIES,
  ];
  readonly supportedTargetKinds: TargetKind[] = [
    "selector",
    "coords",
    "focused",
  ];

  async start(input: ToolStartInput): Promise<ToolStartResult> {
    if (!input.providedEndpoint) {
      throw new Error(
        `modcdp_code startup profile "${input.startupProfile}" requires a providedEndpoint`,
      );
    }

    const connection = await ModCdpConnection.connect(input.providedEndpoint);
    const session = await CdpSession.fromConnection(connection);

    return {
      session,
      cleanup: async () => {
        await session.close();
      },
      metadata: {
        environment:
          input.environment === "BROWSERBASE" ? "browserbase" : "local",
        browserOwnership: input.startupProfile.startsWith("runner_provided")
          ? "runner"
          : "tool",
        connectionMode: connectionModeFromProfile(
          input.startupProfile,
          input.providedEndpoint.kind,
        ),
        startupProfile: input.startupProfile,
      },
    };
  }
}
