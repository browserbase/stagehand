import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";
import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ToolSet } from "ai";
import type { EvalLogger } from "../logger.js";
import { getRepoRootDir } from "../runtimePaths.js";

export type UnderstudyV4ToolDefinition = Record<string, unknown>;

type BridgeReadyMessage = {
  type: "ready";
  cdpUrl: string;
  browserbaseExtensionId?: string;
  stagehand_session_id?: string;
  toolCatalog: UnderstudyV4ToolDefinition[];
};

type BridgeResultMessage = {
  type: "result";
  id: number;
  result?: unknown;
  error?: string;
};

type BridgeEventMessage = {
  type: "event";
  name: string;
  event: unknown;
};

type BridgeErrorMessage = {
  type: "error";
  error: string;
};

type UnderstudyV4Sdk = {
  StagehandClient: new (options?: Record<string, unknown>) => {
    browserbase_extension_id?: string;
    cdp_http_origin?: string;
    connect(input?: unknown): Promise<unknown>;
    close(): Promise<void>;
    cdp: {
      cdp_url?: string | null;
      on(eventName: string, listener: (event: unknown) => void): unknown;
      off(eventName: string, listener: (event: unknown) => void): unknown;
      Stagehand: Record<
        string,
        (params?: Record<string, unknown>) => Promise<unknown>
      >;
    };
    stagehand_session_id?: string;
  };
  StagehandProtocolEvents: Record<string, unknown>;
  aiBrowserToolDefinitions: () => UnderstudyV4ToolDefinition[];
};

export interface UnderstudyV4Tools {
  cdpUrl: string;
  browserbaseExtensionId?: string;
  stagehand_session_id?: string;
  toolCatalog: UnderstudyV4ToolDefinition[];
  stagehandV4: UnderstudyV4NativeRuntime;
  tools: ToolSet;
  cleanup: () => Promise<void>;
}

export interface UnderstudyV4NativeRuntime {
  cdp: {
    on(eventName: string, listener: (event: unknown) => void): void;
    off(eventName: string, listener: (event: unknown) => void): void;
    Mod: Record<string, (params?: Record<string, unknown>) => Promise<unknown>>;
    Stagehand: Record<
      string,
      (params?: Record<string, unknown>) => Promise<unknown>
    >;
  };
}

type PendingCall = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

export async function startUnderstudyV4Tools(input: {
  environment: "LOCAL" | "BROWSERBASE";
  logger: EvalLogger;
}): Promise<UnderstudyV4Tools> {
  const require = createRequire(import.meta.url);
  const tsxCli = require.resolve("tsx/cli");
  const child = spawn(
    process.execPath,
    [tsxCli, fileURLToPath(import.meta.url)],
    {
      cwd: getRepoRootDir(),
      env: {
        ...process.env,
        UNDERSTUDY_V4_TOOLS_CHILD: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

  const pending = new Map<number, PendingCall>();
  const eventListeners = new Map<string, Set<(event: unknown) => void>>();
  const subscribedEvents = new Set<string>();
  let nextId = 1;
  let readyResolve: (message: BridgeReadyMessage) => void;
  let readyReject: (error: Error) => void;
  const readyPromise = new Promise<BridgeReadyMessage>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });

  const stdout = createInterface({ input: child.stdout });
  stdout.on("line", (line) => {
    if (!line.trim()) return;
    const message = parseBridgeMessage(line);
    if (!message) {
      input.logger.log({
        category: "understudy_v4_code",
        message: line,
        level: 1,
      });
      return;
    }
    if (message.type === "ready") {
      readyResolve(message);
      return;
    }
    if (message.type === "event") {
      for (const listener of eventListeners.get(message.name) ?? []) {
        listener(message.event);
      }
      return;
    }
    if (message.type === "error") {
      const error = new Error(message.error);
      readyReject(error);
      for (const call of pending.values()) call.reject(error);
      pending.clear();
      return;
    }
    const call = pending.get(message.id);
    if (!call) return;
    pending.delete(message.id);
    if (message.error) {
      call.reject(new Error(message.error));
    } else {
      call.resolve(message.result);
    }
  });

  child.stderr.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString("utf8").split(/\r?\n/).filter(Boolean)) {
      input.logger.warn({
        category: "understudy_v4_code",
        message: line,
        level: 1,
      });
    }
  });

  child.on("error", (error) => {
    readyReject(error);
    for (const call of pending.values()) call.reject(error);
    pending.clear();
  });
  child.on("exit", (code, signal) => {
    const error = new Error(
      `Understudy v4 tools process exited (${signal ?? code ?? "unknown"}).`,
    );
    readyReject(error);
    for (const call of pending.values()) call.reject(error);
    pending.clear();
  });

  child.stdin.write(
    `${JSON.stringify({ type: "init", environment: input.environment })}\n`,
  );

  const ready = await readyPromise;
  input.logger.log({
    category: "understudy_v4_code",
    message: `Connected v4 tools at ${ready.cdpUrl}`,
    level: 1,
  });
  const callCommand = (name: string, args: Record<string, unknown>) =>
    callBridge(child, pending, nextId++, "command", name, args);
  const callTool = (name: string, args: Record<string, unknown>) =>
    callBridge(child, pending, nextId++, "tool", name, args);
  const { jsonSchema, tool } = await import("ai");

  return {
    cdpUrl: ready.cdpUrl,
    browserbaseExtensionId: ready.browserbaseExtensionId,
    stagehand_session_id: ready.stagehand_session_id,
    toolCatalog: ready.toolCatalog,
    stagehandV4: {
      cdp: {
        on(eventName, listener) {
          let listeners = eventListeners.get(eventName);
          if (!listeners) {
            listeners = new Set();
            eventListeners.set(eventName, listeners);
          }
          listeners.add(listener);
          if (!subscribedEvents.has(eventName)) {
            subscribedEvents.add(eventName);
            child.stdin.write(
              `${JSON.stringify({ type: "subscribe", name: eventName })}\n`,
            );
          }
        },
        off(eventName, listener) {
          const listeners = eventListeners.get(eventName);
          listeners?.delete(listener);
          if (listeners?.size === 0) eventListeners.delete(eventName);
        },
        Mod: new Proxy(
          {},
          {
            get(_target, property) {
              if (typeof property !== "string") return undefined;
              return (params?: Record<string, unknown>) =>
                callCommand(`Mod.${property}`, params ?? {});
            },
          },
        ) as UnderstudyV4NativeRuntime["cdp"]["Mod"],
        Stagehand: new Proxy(
          {},
          {
            get(_target, property) {
              if (typeof property !== "string") return undefined;
              return (params?: Record<string, unknown>) =>
                callCommand(`Stagehand.${property}`, params ?? {});
            },
          },
        ) as UnderstudyV4NativeRuntime["cdp"]["Stagehand"],
      },
    },
    tools: buildUnderstudyV4ToolSet(ready.toolCatalog, callTool, input.logger, {
      jsonSchema,
      tool,
    }),
    cleanup: async () => {
      await closeBridge(child, pending);
    },
  };
}

function buildUnderstudyV4ToolSet(
  catalog: UnderstudyV4ToolDefinition[],
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>,
  logger: EvalLogger,
  ai: Pick<typeof import("ai"), "jsonSchema" | "tool">,
): ToolSet {
  const tools: ToolSet = {};
  const selectorMap: Record<string, Record<string, unknown>> = {};
  for (const definition of catalog) {
    const name = typeof definition.name === "string" ? definition.name : null;
    const rawSchema = definition.inputSchema ?? definition.parameters;
    const schema =
      rawSchema != null &&
      typeof rawSchema === "object" &&
      !Array.isArray(rawSchema)
        ? rawSchema
        : null;
    if (!name) continue;
    if (!schema) continue;
    tools[name] = ai.tool({
      description:
        typeof definition.description === "string"
          ? definition.description
          : name,
      inputSchema: ai.jsonSchema(schema),
      execute: async (args) => {
        logger.log({
          category: "understudy_v4_code",
          message: `Agent calling v4 tool: ${name}`,
          level: 1,
          auxiliary: {
            arguments: {
              value: JSON.stringify(args),
              type: "object",
            },
          },
        });
        const hydratedArgs = hydrateSelectorReferences(
          isRecord(args) ? args : {},
          selectorMap,
        );
        return callTool(name, isRecord(hydratedArgs) ? hydratedArgs : {});
      },
      toModelOutput: (result) => modelOutputForToolResult(result, selectorMap),
    });
  }
  return tools;
}

function modelOutputForToolResult(
  result: unknown,
  selectorMap: Record<string, Record<string, unknown>>,
) {
  const payload = firstPayload(result);
  const screenshot = stringField(payload, "screenshot");
  if (screenshot) {
    return {
      type: "content" as const,
      value: [
        {
          type: "media" as const,
          mediaType: "image/png",
          data: screenshot.replace(/^data:image\/\w+;base64,/, ""),
        },
      ],
    };
  }
  const pageSummary =
    stringField(payload, "formattedTree") ??
    stringField(payload, "observationTree") ??
    stringField(payload, "pageText");
  if (pageSummary) {
    updateSelectorMap(selectorMap, payload.elementSelectorMap);
    return {
      type: "content" as const,
      value: [
        {
          type: "text" as const,
          text: [
            "Page Summary:",
            pageSummary,
            "",
            'Use an element square-bracket id as selector.elementId without brackets, for example {"selector":{"elementId":"0-3"}}.',
          ].join("\n"),
        },
      ],
    };
  }
  return {
    type: "content" as const,
    value: [
      {
        type: "text" as const,
        text: JSON.stringify(sanitizeForModel(payload)),
      },
    ],
  };
}

function callBridge(
  child: ChildProcess,
  pending: Map<number, PendingCall>,
  id: number,
  type: "tool" | "command",
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    child.stdin.write(`${JSON.stringify({ type, id, name, args })}\n`);
  });
}

async function closeBridge(
  child: ChildProcess,
  pending: Map<number, PendingCall>,
): Promise<void> {
  if (child.exitCode != null) return;
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    child.stdin.write(`${JSON.stringify({ type: "close" })}\n`);
    child.stdin.end();
    setTimeout(() => {
      if (child.exitCode == null) child.kill("SIGTERM");
      resolve();
    }, 5000).unref();
  });
  for (const call of pending.values()) {
    call.reject(new Error("Understudy v4 tools process closed."));
  }
  pending.clear();
}

function parseBridgeMessage(
  line: string,
):
  | BridgeReadyMessage
  | BridgeResultMessage
  | BridgeEventMessage
  | BridgeErrorMessage
  | null {
  try {
    const parsed = JSON.parse(line) as
      | BridgeReadyMessage
      | BridgeResultMessage
      | BridgeEventMessage
      | BridgeErrorMessage;
    if (
      parsed.type === "ready" ||
      parsed.type === "result" ||
      parsed.type === "event" ||
      parsed.type === "error"
    ) {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
}

async function runBridgeChild(): Promise<void> {
  const sdk = await loadStagehandV4Sdk();
  const commandByToolName = buildCommandByToolName(sdk);
  let client: InstanceType<UnderstudyV4Sdk["StagehandClient"]> | null = null;
  const eventSubscriptions = new Map<string, (event: unknown) => void>();

  const stdin = createInterface({ input: process.stdin });
  for await (const line of stdin) {
    if (!line.trim()) continue;
    const message = JSON.parse(line) as {
      type: "init" | "tool" | "command" | "subscribe" | "close";
      environment?: "LOCAL" | "BROWSERBASE";
      id?: number;
      name?: string;
      args?: Record<string, unknown>;
    };

    if (message.type === "init") {
      client = new sdk.StagehandClient(
        understudyV4ClientOptions(message.environment ?? "LOCAL"),
      );
      await client.connect();
      let cdpUrl = client.cdp.cdp_url ?? client.cdp_http_origin ?? "";
      if (/^https?:\/\//i.test(cdpUrl)) {
        const versionResponse = await fetch(`${cdpUrl}/json/version`);
        if (!versionResponse.ok) {
          throw new Error(
            `Unable to resolve v4 browser websocket URL from ${cdpUrl}: GET /json/version -> ${versionResponse.status}`,
          );
        }
        const version = (await versionResponse.json()) as {
          webSocketDebuggerUrl?: unknown;
        };
        if (typeof version.webSocketDebuggerUrl !== "string") {
          throw new Error(
            `Unable to resolve v4 browser websocket URL from ${cdpUrl}: missing webSocketDebuggerUrl`,
          );
        }
        cdpUrl = version.webSocketDebuggerUrl;
      }
      writeBridgeMessage({
        type: "ready",
        cdpUrl,
        browserbaseExtensionId: client.browserbase_extension_id,
        stagehand_session_id: client.stagehand_session_id,
        toolCatalog: sdk.aiBrowserToolDefinitions(),
      });
      continue;
    }

    if (message.type === "subscribe") {
      if (!client) throw new Error("Understudy v4 tools were not initialized.");
      const name = message.name;
      if (typeof name !== "string")
        throw new Error("Event subscription requires an event name.");
      if (!eventSubscriptions.has(name)) {
        const listener = (event: unknown): void =>
          writeBridgeMessage({ type: "event", name, event });
        eventSubscriptions.set(name, listener);
        client.cdp.on(name, listener);
      }
      continue;
    }

    if (message.type === "tool" || message.type === "command") {
      if (!client) throw new Error("Understudy v4 tools were not initialized.");
      const id = message.id ?? 0;
      try {
        const commandName =
          message.type === "tool"
            ? commandByToolName.get(message.name ?? "")
            : message.name;
        if (!commandName) {
          throw new Error(
            message.type === "tool"
              ? `No v4 protocol event is exposed for tool "${message.name}".`
              : `No v4 protocol command was provided.`,
          );
        }
        const command =
          message.type === "command"
            ? commandForPath(client.cdp, commandName)
            : client.cdp.Stagehand[commandName];
        if (!command) {
          throw new Error(
            `The v4 SDK does not expose ${
              message.type === "command"
                ? commandName
                : `Stagehand.${commandName}`
            }.`,
          );
        }
        const result = await command(message.args ?? {});
        writeBridgeMessage({ type: "result", id, result });
      } catch (error) {
        writeBridgeMessage({
          type: "result",
          id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      continue;
    }

    if (message.type === "close") {
      if (client) {
        for (const [eventName, listener] of eventSubscriptions) {
          client.cdp.off(eventName, listener);
        }
      }
      await client?.close();
      process.exit(0);
    }
  }
}

export function assertUnderstudyV4SdkAvailable(): string {
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

async function loadStagehandV4Sdk(): Promise<UnderstudyV4Sdk> {
  const sdkPath = assertUnderstudyV4SdkAvailable();
  return (await import(pathToFileURL(sdkPath).href)) as UnderstudyV4Sdk;
}

function understudyV4ClientOptions(
  environment: "LOCAL" | "BROWSERBASE",
): Record<string, unknown> {
  if (process.env.STAGEHAND_V4_CDP_URL) {
    return {
      cdp_url: process.env.STAGEHAND_V4_CDP_URL,
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
      rebuild_extension: false,
      browserbase_session_create_params: {
        browserbase_api_key: process.env.BROWSERBASE_API_KEY,
      },
    };
  }
  return {
    rebuild_extension: false,
    local_browser_launch_options: {
      headless: process.env.EVAL_HEADLESS !== "false",
      ...(process.env.CHROME_PATH
        ? { executable_path: process.env.CHROME_PATH }
        : {}),
    },
  };
}

function buildCommandByToolName(sdk: UnderstudyV4Sdk): Map<string, string> {
  const commandByToolName = new Map<string, string>();
  for (const value of Object.values(sdk.StagehandProtocolEvents)) {
    if (typeof value !== "function") continue;
    const eventClass = value as {
      event_type?: unknown;
      llm_tool_name?: unknown;
    };
    if (
      typeof eventClass.event_type !== "string" ||
      typeof eventClass.llm_tool_name !== "string" ||
      !eventClass.event_type.endsWith("Event")
    ) {
      continue;
    }
    commandByToolName.set(
      eventClass.llm_tool_name,
      eventClass.event_type.slice(0, -"Event".length),
    );
  }
  return commandByToolName;
}

function commandForPath(
  cdp: InstanceType<UnderstudyV4Sdk["StagehandClient"]>["cdp"],
  path: string,
): ((params?: Record<string, unknown>) => Promise<unknown>) | undefined {
  const [domain, method] = path.split(".");
  if (!domain || !method) return undefined;
  const commands = (cdp as unknown as Record<string, unknown>)[domain];
  if (!isRecord(commands)) return undefined;
  const command = commands[method];
  return typeof command === "function"
    ? (command as (params?: Record<string, unknown>) => Promise<unknown>)
    : undefined;
}

function writeBridgeMessage(
  message:
    | BridgeReadyMessage
    | BridgeResultMessage
    | BridgeEventMessage
    | BridgeErrorMessage,
): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function firstPayload(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  const eventResults =
    value.event_results ??
    (isRecord(value.event) ? value.event.event_results : undefined);
  if (isRecord(eventResults)) {
    const first = Object.values(eventResults)[0];
    if (isRecord(first)) {
      if (isRecord(first.result)) return first.result;
      return first;
    }
  }
  return value;
}

function stringField(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function sanitizeForModel(value: unknown): unknown {
  if (typeof value === "string") {
    return value.length > 2000
      ? `${value.slice(0, 2000)}...[truncated]`
      : value;
  }
  if (Array.isArray(value))
    return value.map((entry) => sanitizeForModel(entry));
  if (!isRecord(value)) return value;
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (
      key.toLowerCase().includes("screenshot") ||
      key.toLowerCase().includes("image")
    ) {
      result[key] =
        typeof entry === "string" && entry.length > 80
          ? `${entry.slice(0, 80)}...[truncated]`
          : entry;
      continue;
    }
    result[key] = sanitizeForModel(entry);
  }
  return result;
}

function updateSelectorMap(
  selectorMap: Record<string, Record<string, unknown>>,
  value: unknown,
): void {
  if (!isRecord(value)) return;
  for (const [elementId, selector] of Object.entries(value)) {
    if (isRecord(selector)) selectorMap[elementId] = selector;
  }
}

function hydrateSelectorReferences(
  value: unknown,
  selectorMap: Record<string, Record<string, unknown>>,
): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => hydrateSelectorReferences(entry, selectorMap));
  }
  if (!isRecord(value)) return value;
  const elementId =
    typeof value.elementId === "string" ? value.elementId : null;
  const mappedSelector = elementId == null ? null : selectorMap[elementId];
  const hydratedRecord = Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "elementId")
      .map(([key, entry]) => [
        key,
        hydrateSelectorReferences(entry, selectorMap),
      ]),
  );
  return mappedSelector == null
    ? hydratedRecord
    : { ...mappedSelector, ...hydratedRecord };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

if (
  process.env.UNDERSTUDY_V4_TOOLS_CHILD === "1" &&
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  void runBridgeChild().catch((error) => {
    writeBridgeMessage({
      type: "error",
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });
}
