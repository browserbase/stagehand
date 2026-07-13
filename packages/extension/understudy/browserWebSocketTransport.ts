import type { CdpWebSocketCloseEvent, CdpWebSocketFactory, CdpWebSocketTransport } from "./cdp.js";

/** Adapts the browser-native WebSocket API to the text transport consumed by CDP. */
class BrowserWebSocketTransport implements CdpWebSocketTransport {
  #messageHandlers = new Set<(data: string) => void>();
  #errorHandlers = new Set<(error: Error) => void>();
  #messageQueue: Promise<void> = Promise.resolve();

  constructor(private readonly socket: WebSocket) {
    this.socket.addEventListener("message", (event) => {
      this.#messageQueue = this.#messageQueue
        .then(async () => {
          const data = await browserWebSocketMessageToString(event.data as unknown);
          for (const handler of this.#messageHandlers) handler(data);
        })
        .catch((error: unknown) => {
          const reason =
            error instanceof Error ? error : new Error("Failed to decode CDP websocket message");
          for (const handler of this.#errorHandlers) handler(reason);
          void this.close();
        });
    });
  }

  get connected(): boolean {
    return this.socket.readyState === WebSocket.OPEN;
  }

  send(payload: string): void {
    this.socket.send(payload);
  }

  async close(): Promise<void> {
    if (this.socket.readyState === WebSocket.CLOSED) return;

    await new Promise<void>((resolve) => {
      this.socket.addEventListener("close", () => resolve(), { once: true });
      if (this.socket.readyState !== WebSocket.CLOSING) this.socket.close();
    });
  }

  onMessage(handler: (data: string) => void): void {
    this.#messageHandlers.add(handler);
  }

  onClose(handler: (event: CdpWebSocketCloseEvent) => void): void {
    this.socket.addEventListener("close", (event) => {
      handler({ code: event.code, reason: event.reason });
    });
  }

  onError(handler: (error: Error) => void): void {
    this.#errorHandlers.add(handler);
    this.socket.addEventListener("error", (event) => {
      const message =
        "message" in event && typeof event.message === "string"
          ? event.message
          : "CDP websocket error";
      handler(new Error(message));
    });
  }
}

export const browserWebSocketFactory: CdpWebSocketFactory = async (url) => {
  const socket = new WebSocket(url);
  socket.binaryType = "arraybuffer";
  await waitForWebSocketOpen(socket);
  return new BrowserWebSocketTransport(socket);
};

async function browserWebSocketMessageToString(data: unknown): Promise<string> {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) return new TextDecoder().decode(data);
  if (typeof Blob !== "undefined" && data instanceof Blob) return await data.text();
  throw new TypeError("Unsupported CDP websocket message type");
}

async function waitForWebSocketOpen(socket: WebSocket): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("CDP websocket failed to open"));
    };
    const onClose = () => {
      cleanup();
      reject(new Error("CDP websocket closed before opening"));
    };
    const cleanup = () => {
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("error", onError);
      socket.removeEventListener("close", onClose);
    };

    socket.addEventListener("open", onOpen, { once: true });
    socket.addEventListener("error", onError, { once: true });
    socket.addEventListener("close", onClose, { once: true });
  });
}
