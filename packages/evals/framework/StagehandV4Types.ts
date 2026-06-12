import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { getRepoRootDir } from "../runtimePaths.js";

export type StagehandV4Page = Record<string, unknown> & {
  locator?: Record<string, unknown>;
  targetId?: string;
  title?: string;
  url?: string;
};

export type StagehandV4Browser = Record<string, unknown> & {
  activePage(params?: Record<string, unknown>): Promise<StagehandV4Page | null>;
  connectUrl(): Promise<unknown>;
  newPage(params?: Record<string, unknown>): Promise<StagehandV4Page>;
  pages(params?: Record<string, unknown>): Promise<StagehandV4Page[]>;
};

export type StagehandV4BusSnapshotParams = {
  future?: boolean | number;
  include_json?: boolean;
  past?: boolean | number;
};

export type StagehandV4BusSnapshot = {
  event_count: number;
  events: unknown[];
  generated_at: string;
  json?: unknown;
  logTree: string;
};

export type StagehandV4NativeRuntime = Record<string, unknown> & {
  browser: StagehandV4Browser;
  browserbase_extension_id?: string;
  busLogTree(params?: StagehandV4BusSnapshotParams): Promise<string>;
  busSnapshot(
    params?: StagehandV4BusSnapshotParams,
  ): Promise<StagehandV4BusSnapshot>;
  close(): Promise<void>;
  connect(input?: unknown): Promise<unknown>;
  defaultSessionId(): Promise<string | null>;
  stagehand_session_id?: string;
};

export type StagehandV4Sdk = {
  aiBrowserToolDefinitions(): StagehandV4ToolDefinition[];
  StagehandClient: new (
    options?: Record<string, unknown>,
  ) => StagehandV4NativeRuntime;
};

export type StagehandV4ToolDefinition = Record<string, unknown> & {
  description?: string;
  event_type?: string;
  inputSchema?: Record<string, unknown>;
  name?: string;
  parameters?: Record<string, unknown>;
  sdk_method_name?: string;
};

export function assertStagehandV4SdkAvailable(): string {
  const sdkPath =
    process.env.STAGEHAND_V4_SDK_PATH ??
    path.join(
      getRepoRootDir(),
      "..",
      "stagehand-driver",
      "sdks",
      "js",
      "index.ts",
    );
  if (!fs.existsSync(sdkPath)) {
    throw new Error(
      [
        "stagehand_v4 evals require a local Stagehand v4 SDK checkout.",
        `Expected v4 SDK entrypoint at: ${sdkPath}`,
        "Set STAGEHAND_V4_SDK_PATH to the v4 SDK entrypoint if your checkout lives somewhere else.",
      ].join("\n"),
    );
  }
  return sdkPath;
}

export async function loadStagehandV4Sdk(): Promise<StagehandV4Sdk> {
  const sdkPath = assertStagehandV4SdkAvailable();
  return (await import(pathToFileURL(sdkPath).href)) as StagehandV4Sdk;
}

export function stagehandV4ClientOptions(
  environment: "LOCAL" | "BROWSERBASE",
): Record<string, unknown> {
  if (process.env.STAGEHAND_V4_CDP_URL) {
    return {
      cdp_url: process.env.STAGEHAND_V4_CDP_URL,
      keep_alive: true,
      rebuild_extension: false,
    };
  }
  if (environment === "BROWSERBASE") {
    if (!process.env.BROWSERBASE_API_KEY) {
      throw new Error(
        "BROWSERBASE_API_KEY is required for understudy_v4_code.",
      );
    }
    return {
      keep_alive: true,
      rebuild_extension: false,
      browserbase_session_create_params: {
        browserbase_api_key: process.env.BROWSERBASE_API_KEY,
      },
    };
  }
  return {
    keep_alive: true,
    local_browser_launch_options: {
      headless: process.env.EVAL_HEADLESS !== "false",
      ...(process.env.CHROME_PATH
        ? { executable_path: process.env.CHROME_PATH }
        : {}),
    },
  };
}

export function connectUrlFromResult(result: unknown): string {
  if (typeof result === "string") return result;
  if (isRecord(result) && typeof result.connectURL === "string") {
    return result.connectURL;
  }
  throw new Error("Stagehand SDK did not return a browser connect URL.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}
