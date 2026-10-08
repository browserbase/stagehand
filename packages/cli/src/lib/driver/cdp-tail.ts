import WebSocket from "ws";

import { resolveWsTarget } from "./resolve-ws.js";

interface CdpMessage {
  error?: { code: number; message: string };
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  sessionId?: string;
}

export interface TailCdpOptions {
  domains?: string[];
  pretty?: boolean;
}

export const DEFAULT_CDP_DOMAINS = [
  "Network",
  "Console",
  "Runtime",
  "Log",
  "Page",
];

export async function tailCdp(
  target: string,
  options: TailCdpOptions = {},
): Promise<void> {
  const wsUrl = await resolveWsTarget(target);
  const domains = options.domains?.length
    ? options.domains
    : DEFAULT_CDP_DOMAINS;
  const usePretty = options.pretty ?? false;

  let messageId = 1;
  const pendingIds = new Set<number>();
  const targetSessionMap = new Map<string, string>();

  function send(
    ws: WebSocket,
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
  ): number {
    const id = messageId++;
    pendingIds.add(id);
    const message: Record<string, unknown> = { id, method, params };
    if (sessionId) message.sessionId = sessionId;
    ws.send(JSON.stringify(message));
    return id;
  }

  function enableDomains(ws: WebSocket, sessionId: string): void {
    for (const domain of domains) {
      if (domain === "Network") {
        send(
          ws,
          "Network.enable",
          { maxResourceBufferSize: 100_000, maxTotalBufferSize: 1_000_000 },
          sessionId,
        );
      } else {
        send(ws, `${domain}.enable`, {}, sessionId);
      }

      if (domain === "Page") {
        send(
          ws,
          "Page.setLifecycleEventsEnabled",
          { enabled: true },
          sessionId,
        );
      }
    }
  }

  await new Promise<void>((resolve) => {
    const ws = new WebSocket(wsUrl);
    let closed = false;

    const cleanup = (): void => {
      if (closed) return;
      closed = true;
      if (
        ws.readyState === WebSocket.OPEN ||
        ws.readyState === WebSocket.CONNECTING
      ) {
        ws.close();
      }
      resolve();
    };

    process.once("SIGINT", cleanup);
    process.once("SIGTERM", cleanup);

    ws.on("open", () => {
      if (usePretty) {
        process.stderr.write(`Connected to ${wsUrl}\n`);
      }
      send(ws, "Target.setAutoAttach", {
        autoAttach: true,
        filter: [{ type: "page" }],
        flatten: true,
        waitForDebuggerOnStart: false,
      });
      send(ws, "Target.setDiscoverTargets", {
        discover: true,
        filter: [{ type: "page" }],
      });
    });

    ws.on("message", (raw: WebSocket.RawData) => {
      let message: CdpMessage;
      try {
        message = JSON.parse(raw.toString()) as CdpMessage;
      } catch {
        return;
      }

      if (message.id !== undefined && pendingIds.has(message.id)) {
        pendingIds.delete(message.id);
        if (message.error) {
          process.stderr.write(
            `CDP error (id=${message.id}): ${message.error.message}\n`,
          );
        }
        return;
      }

      if (message.method === "Target.attachedToTarget" && message.params) {
        const params = message.params as {
          sessionId?: string;
          targetInfo?: { targetId?: string; type?: string };
        };
        if (
          params.sessionId &&
          params.targetInfo?.type === "page" &&
          params.targetInfo.targetId
        ) {
          targetSessionMap.set(params.targetInfo.targetId, params.sessionId);
          enableDomains(ws, params.sessionId);
        }
      }

      if (message.method === "Target.detachedFromTarget" && message.params) {
        const params = message.params as {
          sessionId?: string;
          targetId?: string;
        };
        const targetId =
          params.targetId ??
          [...targetSessionMap.entries()].find(
            ([, sessionId]) => sessionId === params.sessionId,
          )?.[0];
        if (targetId) targetSessionMap.delete(targetId);
      }

      writeCdpMessage(message, usePretty);
    });

    ws.on("error", (error: Error) => {
      process.stderr.write(`Error: ${error.message}\n`);
    });

    ws.on("close", () => {
      if (!closed && usePretty) {
        process.stderr.write("Disconnected.\n");
      }
      cleanup();
    });
  });
}

function writeCdpMessage(message: CdpMessage, pretty: boolean): void {
  if (!pretty) {
    writeLine(JSON.stringify(message));
    return;
  }

  const line = formatPrettyCdpMessage(message);
  if (line) writeLine(line);
}

function writeLine(line: string): void {
  try {
    process.stdout.write(`${line}\n`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EPIPE") process.exit(0);
    throw error;
  }
}

function formatPrettyCdpMessage(message: CdpMessage): string | null {
  if (!message.method) return null;
  const params = message.params as Record<string, unknown> | undefined;
  let line = `[${message.method}]`;

  try {
    if (message.method === "Network.requestWillBeSent") {
      const request = params?.request as
        | { method?: string; url?: string }
        | undefined;
      if (request) line += ` ${request.method ?? "?"} ${request.url ?? ""}`;
    } else if (message.method === "Network.responseReceived") {
      const response = params?.response as
        | { status?: number; url?: string }
        | undefined;
      if (response) line += ` ${response.status ?? "?"} ${response.url ?? ""}`;
    } else if (message.method === "Network.loadingFailed") {
      line += ` ${(params?.errorText as string | undefined) ?? "Unknown error"}`;
    } else if (message.method === "Runtime.consoleAPICalled") {
      const type = (params?.type as string | undefined) ?? "log";
      const args =
        (params?.args as
          | Array<{ description?: string; value?: unknown }>
          | undefined) ?? [];
      line += ` [${type}] ${args.map((arg) => arg.description ?? arg.value ?? "").join(" ")}`;
    } else if (message.method === "Runtime.exceptionThrown") {
      const detail = params?.exceptionDetails as
        | { exception?: { description?: string }; text?: string }
        | undefined;
      line += ` ${detail?.exception?.description ?? detail?.text ?? "Unknown exception"}`;
    } else if (message.method === "Page.frameNavigated") {
      const url = (params?.frame as { url?: string } | undefined)?.url;
      if (url) line += ` ${url}`;
    } else if (message.method === "Page.lifecycleEvent") {
      const name = params?.name as string | undefined;
      if (name) line += ` ${name}`;
    } else if (message.method === "Target.attachedToTarget") {
      const info = params?.targetInfo as
        | { type?: string; url?: string }
        | undefined;
      if (info) line += ` [${info.type ?? "?"}] ${info.url ?? ""}`;
    }
  } catch {
    return `[${message.method}]`;
  }

  return line;
}
