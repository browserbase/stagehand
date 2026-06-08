import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import type { ToolSet } from "ai";
import type { EvalLogger } from "../logger.js";
import { getRepoRootDir } from "../runtimePaths.js";
import {
  assertStagehandV4SdkAvailable,
  connectUrlFromResult,
  loadStagehandV4Sdk,
  stagehandV4ClientOptions,
  type StagehandV4NativeRuntime,
  type StagehandV4ToolDefinition,
} from "./StagehandV4Types.js";
import { createStagehandV4ToolCatalog } from "./StagehandV4ToolCatalog.js";

export type UnderstudyV4NativeRuntime = StagehandV4NativeRuntime;
export type UnderstudyV4ToolDefinition = StagehandV4ToolDefinition;
export const assertUnderstudyV4SdkAvailable = assertStagehandV4SdkAvailable;

type BridgeReadyMessage = {
  browserbaseExtensionId?: string;
  cdpUrl: string;
  stagehand_session_id?: string;
  toolCatalog: StagehandV4ToolDefinition[];
  type: "ready";
};

type BridgeResultMessage = {
  error?: string;
  id: number;
  result?: unknown;
  type: "result";
};

type BridgeErrorMessage = {
  error: string;
  type: "error";
};

type PendingCall = {
  reject: (error: Error) => void;
  resolve: (value: unknown) => void;
};

type BridgeRequest =
  | {
      args?: Record<string, unknown>;
      id: number;
      locator?: Record<string, unknown>;
      method: string;
      target: "browser" | "client" | "locator" | "page";
      type: "call";
    }
  | {
      id: number;
      type: "close";
    }
  | {
      environment: "LOCAL" | "BROWSERBASE";
      type: "init";
    };

type BridgeReference = {
  __stagehand_v4_bridge_kind: "locator" | "page";
  locator: Record<string, unknown>;
};

export interface UnderstudyV4Tools {
  browserbaseExtensionId?: string;
  cdpUrl: string;
  cleanup: () => Promise<void>;
  stagehand_session_id?: string;
  stagehandV4: StagehandV4NativeRuntime;
  toolCatalog: StagehandV4ToolDefinition[];
  tools: ToolSet;
}

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
      call.resolve(
        hydrateBridgeValue(child, pending, nextIdRef, message.result),
      );
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
  child.on("error", rejectAll);
  child.on("exit", (code, signal) => {
    rejectAll(
      new Error(
        `Understudy v4 tools process exited (${signal ?? code ?? "unknown"}).`,
      ),
    );
  });

  const nextIdRef = {
    next(): number {
      return nextId++;
    },
  };
  child.stdin.write(
    `${JSON.stringify({ type: "init", environment: input.environment } satisfies BridgeRequest)}\n`,
  );

  const ready = await readyPromise;
  const stagehandV4 = createStagehandV4BridgeRuntime(child, pending, nextIdRef);
  const tools = await createStagehandV4ToolCatalog({
    client: stagehandV4,
    definitions: ready.toolCatalog,
    logger: input.logger,
  });

  input.logger.log({
    category: "understudy_v4_code",
    message: `Connected v4 tools at ${ready.cdpUrl}`,
    level: 1,
  });
  input.logger.log({
    category: "understudy_v4_code",
    message: `v4 stagehand_session_id=${ready.stagehand_session_id ?? "unknown"}`,
    level: 1,
  });

  return {
    browserbaseExtensionId: ready.browserbaseExtensionId,
    cdpUrl: ready.cdpUrl,
    cleanup: async () => {
      await closeBridge(child, pending, nextIdRef);
    },
    stagehand_session_id: ready.stagehand_session_id,
    stagehandV4,
    toolCatalog: tools.definitions,
    tools: tools.tools,
  };

  function rejectAll(error: Error): void {
    readyReject(error);
    for (const call of pending.values()) call.reject(error);
    pending.clear();
  }
}

function createStagehandV4BridgeRuntime(
  child: ChildProcess,
  pending: Map<number, PendingCall>,
  nextId: { next(): number },
): StagehandV4NativeRuntime {
  return {
    browser: createBrowserBridge(child, pending, nextId),
    busLogTree: async (params) =>
      (await callBridge(child, pending, nextId, {
        target: "client",
        method: "busLogTree",
        args: params,
      })) as string,
    busSnapshot: async (params) =>
      (await callBridge(child, pending, nextId, {
        target: "client",
        method: "busSnapshot",
        args: params,
      })) as Awaited<ReturnType<StagehandV4NativeRuntime["busSnapshot"]>>,
    close: async () => {
      await closeBridge(child, pending, nextId);
    },
    connect: async (input) =>
      await callBridge(child, pending, nextId, {
        target: "client",
        method: "connect",
        args: isRecord(input) ? input : {},
      }),
    defaultSessionId: async () =>
      (await callBridge(child, pending, nextId, {
        target: "client",
        method: "defaultSessionId",
        args: {},
      })) as string | null,
  };
}

function createBrowserBridge(
  child: ChildProcess,
  pending: Map<number, PendingCall>,
  nextId: { next(): number },
): StagehandV4NativeRuntime["browser"] {
  return {
    activePage: async (params) =>
      (await callBridge(child, pending, nextId, {
        target: "browser",
        method: "activePage",
        args: params,
      })) as Awaited<
        ReturnType<StagehandV4NativeRuntime["browser"]["activePage"]>
      >,
    connectUrl: async () =>
      await callBridge(child, pending, nextId, {
        target: "browser",
        method: "connectUrl",
        args: {},
      }),
    newPage: async (params) =>
      (await callBridge(child, pending, nextId, {
        target: "browser",
        method: "newPage",
        args: params,
      })) as Awaited<
        ReturnType<StagehandV4NativeRuntime["browser"]["newPage"]>
      >,
    pages: async (params) =>
      (await callBridge(child, pending, nextId, {
        target: "browser",
        method: "pages",
        args: params,
      })) as Awaited<ReturnType<StagehandV4NativeRuntime["browser"]["pages"]>>,
  };
}

function createPageBridge(
  child: ChildProcess,
  pending: Map<number, PendingCall>,
  nextId: { next(): number },
  locator: Record<string, unknown>,
): Record<string, unknown> {
  const page = {
    ...locator,
    locator,
    toJSON: () => locator,
  };
  return new Proxy(page, {
    get(target, property, receiver) {
      if (typeof property !== "string") {
        return Reflect.get(target, property, receiver);
      }
      if (
        property === "then" ||
        property === "catch" ||
        property === "finally"
      ) {
        return undefined;
      }
      if (property in target) return Reflect.get(target, property, receiver);
      return async (params?: Record<string, unknown>) =>
        await callBridge(child, pending, nextId, {
          target: "page",
          method: property,
          locator,
          args: params ?? {},
        });
    },
  });
}

function createLocatorBridge(
  child: ChildProcess,
  pending: Map<number, PendingCall>,
  nextId: { next(): number },
  locator: Record<string, unknown>,
): Record<string, unknown> {
  const bridgeLocator = {
    ...locator,
    locator,
    toJSON: () => locator,
  };
  return new Proxy(bridgeLocator, {
    get(target, property, receiver) {
      if (typeof property !== "string") {
        return Reflect.get(target, property, receiver);
      }
      if (
        property === "then" ||
        property === "catch" ||
        property === "finally"
      ) {
        return undefined;
      }
      if (property in target) return Reflect.get(target, property, receiver);
      return async (params?: Record<string, unknown>) =>
        await callBridge(child, pending, nextId, {
          target: "locator",
          method: property,
          locator,
          args: params ?? {},
        });
    },
  });
}

function callBridge(
  child: ChildProcess,
  pending: Map<number, PendingCall>,
  nextId: { next(): number },
  request: Omit<Extract<BridgeRequest, { type: "call" }>, "id" | "type">,
): Promise<unknown> {
  const id = nextId.next();
  const message: BridgeRequest = { ...request, id, type: "call" };
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    child.stdin.write(`${JSON.stringify(message)}\n`);
  });
}

function closeBridge(
  child: ChildProcess,
  pending: Map<number, PendingCall>,
  nextId: { next(): number },
): Promise<void> {
  if (child.exitCode != null || child.killed) return Promise.resolve();
  const id = nextId.next();
  return new Promise((resolve) => {
    pending.set(id, {
      resolve: () => resolve(),
      reject: () => resolve(),
    });
    child.stdin.write(
      `${JSON.stringify({ type: "close", id } satisfies BridgeRequest)}\n`,
    );
    setTimeout(() => {
      if (child.exitCode == null && !child.killed) child.kill();
      resolve();
    }, 250).unref?.();
  });
}

function hydrateBridgeValue(
  child: ChildProcess,
  pending: Map<number, PendingCall>,
  nextId: { next(): number },
  value: unknown,
): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) =>
      hydrateBridgeValue(child, pending, nextId, entry),
    );
  }
  if (!isRecord(value)) return value;
  if (value.__stagehand_v4_bridge_kind === "page" && isRecord(value.locator)) {
    return createPageBridge(child, pending, nextId, value.locator);
  }
  if (
    value.__stagehand_v4_bridge_kind === "locator" &&
    isRecord(value.locator)
  ) {
    return createLocatorBridge(child, pending, nextId, value.locator);
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      hydrateBridgeValue(child, pending, nextId, entry),
    ]),
  );
}

function parseBridgeMessage(
  line: string,
): BridgeReadyMessage | BridgeResultMessage | BridgeErrorMessage | null {
  try {
    const parsed = JSON.parse(line) as unknown;
    if (!isRecord(parsed)) return null;
    if (parsed.type === "ready" && typeof parsed.cdpUrl === "string") {
      return parsed as BridgeReadyMessage;
    }
    if (parsed.type === "result" && typeof parsed.id === "number") {
      return parsed as BridgeResultMessage;
    }
    if (parsed.type === "error" && typeof parsed.error === "string") {
      return parsed as BridgeErrorMessage;
    }
    return null;
  } catch {
    return null;
  }
}

async function runChild(): Promise<void> {
  let sdk: Awaited<ReturnType<typeof loadStagehandV4Sdk>> | undefined;
  let client: StagehandV4NativeRuntime | undefined;
  const clients: StagehandV4NativeRuntime[] = [];
  const stdin = createInterface({ input: process.stdin });
  let requestQueue = Promise.resolve();
  stdin.on("line", (line) => {
    requestQueue = requestQueue
      .catch(() => {})
      .then(async () => {
        const message = parseBridgeRequest(line);
        try {
          if (message == null) return;
          if (message.type === "init") {
            sdk = await loadStagehandV4Sdk();
            client = new sdk.StagehandClient(
              stagehandV4ClientOptions(message.environment),
            );
            clients.push(client);
            await client.connect();
            const defaultSessionId = await childDefaultSessionId(client);
            writeBridgeMessage({
              type: "ready",
              cdpUrl: connectUrlFromResult(await client.browser.connectUrl()),
              browserbaseExtensionId: client.browserbase_extension_id,
              stagehand_session_id:
                defaultSessionId ?? client.stagehand_session_id,
              toolCatalog: sdk.aiBrowserToolDefinitions(),
            } satisfies BridgeReadyMessage);
            return;
          }
          if (message.type === "close") {
            for (const runtime of [...clients].reverse()) {
              await runtime.close().catch(() => {});
            }
            writeBridgeMessage({
              type: "result",
              id: message.id,
            } satisfies BridgeResultMessage);
            process.exit(0);
          }
          if (client == null)
            throw new Error("Stagehand v4 client is not initialized.");
          const result = await callChildTarget(
            {
              client,
              clients,
              sdk,
              setClient(nextClient) {
                client = nextClient;
              },
            },
            message,
          );
          writeBridgeMessage({
            type: "result",
            id: message.id,
            result: serializeBridgeValue(result),
          } satisfies BridgeResultMessage);
        } catch (error) {
          if (message != null && "id" in message) {
            writeBridgeMessage({
              type: "result",
              id: message.id,
              error: error instanceof Error ? error.message : String(error),
            } satisfies BridgeResultMessage);
          } else {
            writeBridgeMessage({
              type: "error",
              error: error instanceof Error ? error.message : String(error),
            } satisfies BridgeErrorMessage);
          }
        }
      });
  });
}

async function callChildTarget(
  state: {
    client: StagehandV4NativeRuntime;
    clients: StagehandV4NativeRuntime[];
    sdk: Awaited<ReturnType<typeof loadStagehandV4Sdk>> | undefined;
    setClient: (client: StagehandV4NativeRuntime) => void;
  },
  message: Extract<BridgeRequest, { type: "call" }>,
): Promise<unknown> {
  const client = state.client;
  if (message.target === "client") {
    if (
      message.method === "connect" &&
      typeof message.args?.cdp_url === "string"
    ) {
      if (state.sdk == null) {
        throw new Error("Stagehand v4 SDK is not loaded.");
      }
      const nextClient = new state.sdk.StagehandClient({
        cdp_url: message.args.cdp_url,
        keep_alive: true,
        rebuild_extension: false,
      });
      await nextClient.connect();
      state.clients.push(nextClient);
      state.setClient(nextClient);
      return undefined;
    }
    if (message.method === "defaultSessionId") {
      return await childDefaultSessionId(client);
    }
    if (message.method === "busSnapshot") {
      return await childBusSnapshotForClients(
        state.clients,
        message.args ?? {},
      );
    }
    if (message.method === "busLogTree") {
      return (
        await childBusSnapshotForClients(state.clients, message.args ?? {})
      ).logTree;
    }
    return await callMethod(client, message.method, message.args ?? {});
  }
  if (message.target === "browser") {
    return await callMethod(client.browser, message.method, message.args ?? {});
  }
  if (message.target === "page") {
    const page = await childPageForLocator(client, message.locator ?? {});
    return await callMethod(page, message.method, message.args ?? {});
  }
  const page = await childPageForLocator(client, message.locator ?? {});
  const locate = page.locate;
  if (typeof locate !== "function") {
    throw new Error("Stagehand SDK page.locate is not available.");
  }
  const locator = await locate.call(page, message.locator ?? {});
  return await callMethod(locator, message.method, message.args ?? {});
}

async function childDefaultSessionId(
  client: StagehandV4NativeRuntime,
): Promise<string | null> {
  const method = client.defaultSessionId;
  if (typeof method === "function") return await method.call(client);
  return typeof client.stagehand_session_id === "string"
    ? client.stagehand_session_id
    : null;
}

async function childBusSnapshot(
  client: StagehandV4NativeRuntime,
  params: Record<string, unknown>,
): Promise<{
  event_count: number;
  events: unknown[];
  generated_at: string;
  json?: unknown;
  logTree: string;
}> {
  const cdp = isRecord(client.cdp) ? client.cdp : client;
  const mod = isRecord(cdp.Mod) ? cdp.Mod : undefined;
  const evaluate = mod?.evaluate;
  if (typeof evaluate !== "function") {
    throw new Error("Stagehand SDK method busSnapshot is not available.");
  }
  const evaluated = await evaluate.call(mod, {
    expression: `async (params) => {
      const bus = globalThis.ModCDP?.bus;
      if (bus == null) {
        return JSON.stringify({ error: "globalThis.ModCDP.bus is not available" });
      }
      const toPlain = (value, seen = new WeakSet(), depth = 0) => {
        if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
          return value;
        }
        if (typeof value === "bigint") return String(value);
        if (typeof value === "function" || typeof value === "symbol" || typeof value === "undefined") {
          return undefined;
        }
        if (value instanceof Error) {
          return {
            name: value.name,
            message: value.message,
            stack: value.stack,
          };
        }
        if (depth > 24) return "[MaxDepth]";
        if (typeof value !== "object") return value;
        if (seen.has(value)) return "[Circular]";
        seen.add(value);
        if (Array.isArray(value)) {
          const array = value.map((entry) => toPlain(entry, seen, depth + 1));
          seen.delete(value);
          return array;
        }
        const record = {};
        for (const [key, entry] of Object.entries(value)) {
          const plain = toPlain(entry, seen, depth + 1);
          if (plain !== undefined) record[key] = plain;
        }
        seen.delete(value);
        return record;
      };
      const publicEntries = (value, blockedKeys = new Set()) =>
        Object.fromEntries(
          Object.entries(value).filter(([key, entry]) =>
            !key.startsWith("_") &&
            !blockedKeys.has(key) &&
            typeof entry !== "function" &&
            entry !== undefined
          ).map(([key, entry]) => [key, toPlain(entry)]),
        );
      const safeGet = (value, key) => {
        try {
          return value?.[key];
        } catch {
          return undefined;
        }
      };
      const resultJson = (result, handlerId) => {
        const record = publicEntries(result, new Set(["event", "handler", "bus"]));
        const event = safeGet(result, "event");
        const handler = safeGet(result, "handler");
        record.id ??= safeGet(result, "id");
        record.status ??= safeGet(result, "status");
        record.event_id ??= safeGet(event, "event_id");
        record.handler_id ??= safeGet(result, "handler_id") ?? handlerId;
        record.handler_name ??= safeGet(result, "handler_name") ?? safeGet(handler, "handler_name");
        record.handler_file_path ??= safeGet(result, "handler_file_path");
        record.handler_registered_at ??= safeGet(handler, "handler_registered_at");
        record.handler_event_pattern ??= safeGet(handler, "event_pattern");
        record.eventbus_name ??= safeGet(result, "eventbus_name") ?? safeGet(handler, "eventbus_name");
        record.eventbus_id ??= safeGet(result, "eventbus_id") ?? safeGet(handler, "eventbus_id");
        record.started_at ??= safeGet(result, "started_at");
        record.completed_at ??= safeGet(result, "completed_at");
        record.result ??= toPlain(safeGet(result, "result"));
        record.error ??= toPlain(safeGet(result, "error"));
        const eventChildren = safeGet(result, "event_children");
        if (Array.isArray(eventChildren)) {
          record.event_children ??= eventChildren.map((child) => safeGet(child, "event_id")).filter(Boolean);
        }
        return record;
      };
      const eventJson = (event) => {
        const record = publicEntries(
          event,
          new Set(["bus", "event_bus", "event_schema", "event_results"]),
        );
        record.event_id ??= safeGet(event, "event_id");
        record.event_type ??= safeGet(event, "event_type");
        record.event_version ??= safeGet(event, "event_version");
        record.event_result_type ??= toPlain(safeGet(event, "event_result_type"));
        record.event_parent_id ??= safeGet(event, "event_parent_id");
        record.event_path ??= toPlain(safeGet(event, "event_path"));
        record.event_emitted_by_handler_id ??= safeGet(event, "event_emitted_by_handler_id");
        record.event_pending_bus_count ??= safeGet(event, "event_pending_bus_count");
        record.event_status ??= safeGet(event, "event_status");
        record.event_created_at ??= safeGet(event, "event_created_at");
        record.event_started_at ??= safeGet(event, "event_started_at") ?? null;
        record.event_completed_at ??= safeGet(event, "event_completed_at") ?? null;
        const eventResults = safeGet(event, "event_results");
        if (eventResults instanceof Map && eventResults.size > 0) {
          record.event_results = Object.fromEntries(
            Array.from(eventResults.entries()).map(([handlerId, result]) => [
              handlerId,
              resultJson(result, handlerId),
            ]),
          );
        }
        return record;
      };
      const filterOptions = {
        past: params.past ?? 5,
        future: params.future ?? false,
      };
      const eventHistory = Array.from(bus.event_history?.values?.() ?? []);
      const eventCutoff =
        filterOptions.past === true
          ? null
          : filterOptions.past === false
            ? Infinity
            : Date.now() - Math.max(0, Number(filterOptions.past ?? 5)) * 1000;
      const events = eventHistory.filter((event) => {
        if (eventCutoff === Infinity) return false;
        if (eventCutoff === null) return true;
        const updatedAt = Date.parse(String(
          safeGet(event, "event_completed_at") ??
          safeGet(event, "event_started_at") ??
          safeGet(event, "event_created_at") ??
          ""
        ));
        return Number.isFinite(updatedAt) && updatedAt >= eventCutoff;
      });
      let fullJson;
      if (params.include_json === true) {
        try {
          fullJson = bus.toJSON();
        } catch (error) {
          fullJson = {
            id: bus.id,
            name: bus.name,
            event_history: Object.fromEntries(
              Array.from(bus.event_history.entries()).map(([eventId, event]) => [
                eventId,
                eventJson(event),
              ]),
            ),
            error: error instanceof Error ? error.message : String(error),
          };
        }
        fullJson = toPlain(fullJson);
      }
      let logTree = "";
      try {
        logTree = bus.logTree();
      } catch (error) {
        logTree =
          "Unable to render bus log tree: " +
          (error instanceof Error ? error.message : String(error));
      }
      return JSON.stringify({
        event_count: bus.event_history.size,
        events: events.map(eventJson),
        generated_at: new Date().toISOString(),
        ...(fullJson === undefined ? {} : { json: fullJson }),
        logTree,
      });
    }`,
    params,
  });
  const result =
    typeof evaluated === "string"
      ? (JSON.parse(evaluated) as unknown)
      : evaluated;
  if (!isRecord(result) || typeof result.event_count !== "number") {
    throw new Error("Stagehand busSnapshot returned an invalid result.");
  }
  if (typeof result.error === "string") {
    throw new Error(result.error);
  }
  return {
    event_count: result.event_count,
    events: Array.isArray(result.events) ? result.events : [],
    generated_at:
      typeof result.generated_at === "string"
        ? result.generated_at
        : new Date().toISOString(),
    ...(result.json === undefined ? {} : { json: result.json }),
    logTree: typeof result.logTree === "string" ? result.logTree : "",
  };
}

async function childBusSnapshotForClients(
  clients: StagehandV4NativeRuntime[],
  params: Record<string, unknown>,
): Promise<{
  event_count: number;
  events: unknown[];
  generated_at: string;
  json?: unknown;
  logTree: string;
}> {
  const eventHistory = new Map<string, unknown>();
  const eventsById = new Map<string, unknown>();
  const logTrees: string[] = [];
  let generatedAt = new Date().toISOString();
  let successCount = 0;
  let lastError: unknown;

  for (const client of clients) {
    try {
      const snapshot = await childBusSnapshot(client, params);
      successCount += 1;
      generatedAt = snapshot.generated_at;
      logTrees.push(snapshot.logTree);
      for (const event of snapshot.events) {
        const id =
          isRecord(event) && typeof event.event_id === "string"
            ? event.event_id
            : undefined;
        if (id != null) eventsById.set(id, event);
      }
      const json = isRecord(snapshot.json) ? snapshot.json : undefined;
      const history = isRecord(json?.event_history)
        ? json.event_history
        : undefined;
      if (history != null) {
        for (const [eventId, event] of Object.entries(history)) {
          eventHistory.set(eventId, event);
        }
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (successCount === 0) {
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  return {
    event_count: eventHistory.size || eventsById.size,
    events: [...eventsById.values()],
    generated_at: generatedAt,
    ...(params.include_json === true
      ? {
          json: {
            name: "StagehandSession",
            event_history: Object.fromEntries(eventHistory),
          },
        }
      : {}),
    logTree: logTrees.filter(Boolean).join("\n\n"),
  };
}

async function childPageForLocator(
  client: StagehandV4NativeRuntime,
  locator: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const locatedPages =
    Object.keys(locator).length > 0
      ? await client.browser
          .pages(locator)
          .catch((): Record<string, unknown>[] => [])
      : [];
  if (locatedPages[0] != null) return locatedPages[0];
  const pages = await client.browser
    .pages({})
    .catch((): Record<string, unknown>[] => []);
  const page =
    pages.find((candidate) => {
      const url = typeof candidate.url === "string" ? candidate.url : undefined;
      return (
        url != null &&
        url !== "about:blank" &&
        !/^chrome(?:-[a-z]+)?:\/\//u.test(url)
      );
    }) ?? pages[0];
  if (page != null) return page;
  return await client.browser.newPage();
}

async function callMethod(
  target: Record<string, unknown>,
  methodName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const method = target[methodName];
  if (typeof method !== "function") {
    throw new Error(`Stagehand SDK method ${methodName} is not available.`);
  }
  return await method.call(target, args);
}

function serializeBridgeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(serializeBridgeValue);
  if (!isRecord(value)) return value;
  const constructorName =
    typeof value.constructor?.name === "string" ? value.constructor.name : "";
  const toJSON = value.toJSON;
  if (
    (constructorName === "Page" || constructorName === "Locator") &&
    typeof toJSON === "function"
  ) {
    return {
      __stagehand_v4_bridge_kind:
        constructorName === "Page" ? "page" : "locator",
      locator: toJSON.call(value),
    } satisfies BridgeReference;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      serializeBridgeValue(entry),
    ]),
  );
}

function parseBridgeRequest(line: string): BridgeRequest | null {
  try {
    const parsed = JSON.parse(line) as unknown;
    if (!isRecord(parsed) || typeof parsed.type !== "string") return null;
    return parsed as BridgeRequest;
  } catch {
    return null;
  }
}

function writeBridgeMessage(
  message: BridgeReadyMessage | BridgeResultMessage | BridgeErrorMessage,
): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

if (process.env.UNDERSTUDY_V4_TOOLS_CHILD === "1") {
  void runChild().catch((error) => {
    writeBridgeMessage({
      type: "error",
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });
}
