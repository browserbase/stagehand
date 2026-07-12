import type {
  CdpWebSocketCloseEvent,
  CdpWebSocketFactory,
  CdpWebSocketTransport,
} from "../understudy/cdp.js";
import {
  StagehandRuntimeError,
  type LoopbackCdpConnection,
  type LoopbackCdpConnectionFactory,
} from "../services/stagehandRuntimeService.js";

type CdpResponse<Result> = {
  id: number;
  result?: Result;
  error?: {
    code: number;
    message: string;
  };
};

type PendingCdpRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
};

class BrowserLoopbackCdpConnection implements LoopbackCdpConnection {
  #nextId = 1;
  #pending = new Map<number, PendingCdpRequest>();

  private constructor(private readonly socket: WebSocket) {
    this.socket.addEventListener("message", (event) => {
      this.handleMessage(event.data).catch((error: unknown) => {
        for (const pending of this.#pending.values()) {
          pending.reject(
            error instanceof Error ? error : new Error("Failed to handle loopback CDP message"),
          );
        }
        this.#pending.clear();
      });
    });

    this.socket.addEventListener("close", () => {
      this.rejectPending("Loopback CDP websocket closed");
    });

    this.socket.addEventListener("error", () => {
      this.rejectPending("Loopback CDP websocket error");
    });
  }

  get connected(): boolean {
    return this.socket.readyState === WebSocket.OPEN;
  }

  static async connect(cdpUrl: string): Promise<BrowserLoopbackCdpConnection> {
    const socket = new WebSocket(cdpUrl);

    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener(
        "error",
        () => reject(new Error("Loopback CDP websocket failed to open")),
        { once: true },
      );
    });

    return new BrowserLoopbackCdpConnection(socket);
  }

  async send<Result = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<Result> {
    if (!this.connected) {
      throw new StagehandRuntimeError(
        "Stagehand loopback CDP is disconnected",
        -32001,
        "stagehand.loopback_disconnected",
      );
    }

    const id = this.#nextId++;

    return await new Promise<Result>((resolve, reject) => {
      this.#pending.set(id, {
        resolve: (value) => resolve(value as Result),
        reject,
      });

      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close(): void {
    this.socket.close();
  }

  private async handleMessage(data: unknown): Promise<void> {
    const message = JSON.parse(await messageDataToString(data)) as Partial<CdpResponse<unknown>>;

    if (typeof message.id !== "number") return;

    const pending = this.#pending.get(message.id);
    if (!pending) return;

    this.#pending.delete(message.id);

    if (message.error) {
      pending.reject(
        new StagehandRuntimeError(
          message.error.message,
          message.error.code,
          "stagehand.loopback_cdp_error",
        ),
      );
      return;
    }

    pending.resolve(message.result);
  }

  private rejectPending(message: string): void {
    for (const pending of this.#pending.values()) {
      pending.reject(new StagehandRuntimeError(message, -32001, "stagehand.loopback_disconnected"));
    }
    this.#pending.clear();
  }
}

class BrowserWebSocketTransport implements CdpWebSocketTransport {
  constructor(private readonly ws: WebSocket) {}

  get readyState(): number {
    return this.ws.readyState;
  }

  send(payload: string): void {
    this.ws.send(payload);
  }

  close(): void {
    this.ws.close();
  }

  onMessage(handler: (payload: string) => void): void {
    this.ws.addEventListener("message", (event) => {
      void messageDataToString(event.data).then(handler);
    });
  }

  onClose(handler: (event: CdpWebSocketCloseEvent) => void): void {
    this.ws.addEventListener("close", (event) => {
      handler({ code: event.code, reason: event.reason });
    });
  }

  onError(handler: (error: Error) => void): void {
    this.ws.addEventListener("error", () => {
      handler(new Error("CDP websocket error"));
    });
  }

  onceClose(handler: (event: CdpWebSocketCloseEvent) => void): void {
    this.ws.addEventListener(
      "close",
      (event) => {
        handler({ code: event.code, reason: event.reason });
      },
      { once: true },
    );
  }
}

export const browserLoopbackCdpFactory: LoopbackCdpConnectionFactory = (cdpUrl) =>
  BrowserLoopbackCdpConnection.connect(cdpUrl);

export const browserWebSocketFactory: CdpWebSocketFactory = async (wsUrl, options) => {
  const unsupportedHeaders = Object.keys(options?.headers ?? {}).filter(
    (header) => header.toLowerCase() !== "user-agent",
  );

  if (unsupportedHeaders.length > 0) {
    throw new Error("Browser WebSocket transport does not support custom headers");
  }

  const ws = new WebSocket(wsUrl);

  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", () => reject(new Error("CDP websocket failed to open")), {
      once: true,
    });
  });

  return new BrowserWebSocketTransport(ws);
};

async function messageDataToString(data: unknown): Promise<string> {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (data instanceof Blob) return data.text();

  return new TextDecoder().decode(data as ArrayBufferView);
}
