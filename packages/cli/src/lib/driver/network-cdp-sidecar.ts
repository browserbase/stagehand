import WebSocket from "ws";

import { DriverError } from "./errors.js";

type CdpEventListener = (params: unknown) => void;

interface CdpMessage {
  error?: { code: number; message: string };
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  sessionId?: string;
}

interface PendingCommand {
  method: string;
  reject: (error: Error) => void;
  resolve: (result: unknown) => void;
}

export interface NetworkCdpSession {
  readonly connected: boolean;
  detach(): Promise<void>;
  off(event: string, listener: CdpEventListener): void;
  on(event: string, listener: CdpEventListener): void;
  send<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<T>;
}

export type NetworkCdpWebSocketFactory = (url: string) => WebSocket;

/**
 * A CLI-owned browser-level CDP connection used only for V3-compatible
 * network capture. The connection is intentionally kept alive across
 * `network off`/`network on`: Browserbase treats closing an auxiliary browser
 * WebSocket as a browser-session disconnect. It is closed only with the Browse
 * driver session.
 */
export class NetworkCdpSidecar {
  private connecting: Promise<void> | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, PendingCommand>();
  private readonly sessions = new Map<
    string,
    Map<string, Set<CdpEventListener>>
  >();
  private socket: WebSocket | null = null;
  private websocketUrl: string | null = null;

  constructor(
    private readonly createWebSocket: NetworkCdpWebSocketFactory = (url) =>
      new WebSocket(url),
  ) {}

  async attach(
    websocketUrl: string,
    targetId: string,
  ): Promise<NetworkCdpSession> {
    await this.ensureConnected(websocketUrl);
    const { sessionId } = await this.sendCommand<{ sessionId: string }>(
      "Target.attachToTarget",
      { flatten: true, targetId },
    );
    this.sessions.set(sessionId, new Map());
    return new AttachedNetworkCdpSession(this, sessionId);
  }

  close(): void {
    const socket = this.socket;
    this.disconnect(
      socket,
      new DriverError("Network capture CDP sidecar closed.", {
        code: "network_sidecar_closed",
      }),
    );
    if (
      socket &&
      (socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING)
    ) {
      socket.close();
    }
  }

  hasSession(sessionId: string): boolean {
    return (
      this.socket?.readyState === WebSocket.OPEN && this.sessions.has(sessionId)
    );
  }

  on(sessionId: string, event: string, listener: CdpEventListener): void {
    const listeners = this.sessions.get(sessionId);
    if (!listeners) return;
    const eventListeners = listeners.get(event) ?? new Set<CdpEventListener>();
    eventListeners.add(listener);
    listeners.set(event, eventListeners);
  }

  off(sessionId: string, event: string, listener: CdpEventListener): void {
    const listeners = this.sessions.get(sessionId);
    const eventListeners = listeners?.get(event);
    eventListeners?.delete(listener);
    if (eventListeners?.size === 0) listeners?.delete(event);
  }

  async sendToSession<T = unknown>(
    sessionId: string,
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    if (!this.sessions.has(sessionId)) {
      throw new DriverError("Network capture CDP session is detached.", {
        code: "network_sidecar_detached",
      });
    }
    return this.sendCommand<T>(method, params, sessionId);
  }

  async detach(sessionId: string): Promise<void> {
    if (!this.sessions.has(sessionId)) return;
    this.sessions.delete(sessionId);
    await this.sendCommand("Target.detachFromTarget", { sessionId }).catch(
      () => undefined,
    );
  }

  private async ensureConnected(websocketUrl: string): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) {
      if (this.websocketUrl !== websocketUrl) {
        throw new DriverError(
          "The browser CDP endpoint changed during the Browse session.",
          { code: "network_sidecar_endpoint_changed" },
        );
      }
      return;
    }
    if (this.connecting) {
      await this.connecting;
      return;
    }

    const connecting = this.open(websocketUrl);
    this.connecting = connecting;
    try {
      await connecting;
    } finally {
      if (this.connecting === connecting) this.connecting = null;
    }
  }

  private async open(websocketUrl: string): Promise<void> {
    let socket: WebSocket;
    try {
      socket = this.createWebSocket(websocketUrl);
    } catch (error) {
      throw connectionError(error);
    }
    this.socket = socket;
    this.websocketUrl = websocketUrl;

    await new Promise<void>((resolve, reject) => {
      let opened = false;
      socket.on("message", (raw: WebSocket.RawData) => {
        this.handleMessage(socket, raw);
      });
      socket.on("error", (error: Error) => {
        const failure = connectionError(error);
        this.disconnect(socket, failure);
        if (!opened) reject(failure);
      });
      socket.on("close", () => {
        const error = new DriverError(
          "Network capture CDP sidecar disconnected.",
          { code: "network_sidecar_disconnected" },
        );
        this.disconnect(socket, error);
        if (!opened) reject(connectionError(error));
      });
      socket.once("open", () => {
        opened = true;
        resolve();
      });
    });
  }

  private sendCommand<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
  ): Promise<T> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(
        new DriverError("Network capture CDP sidecar is not connected.", {
          code: "network_sidecar_disconnected",
        }),
      );
    }

    const id = this.nextId++;
    const message = sessionId
      ? { id, method, params, sessionId }
      : { id, method, params };
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        method,
        reject,
        resolve: (result) => resolve(result as T),
      });
      try {
        socket.send(JSON.stringify(message));
      } catch (error) {
        this.pending.delete(id);
        reject(commandError(method, error));
      }
    });
  }

  private handleMessage(socket: WebSocket, raw: WebSocket.RawData): void {
    if (this.socket !== socket) return;
    let message: CdpMessage;
    try {
      message = JSON.parse(raw.toString()) as CdpMessage;
    } catch {
      return;
    }

    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(commandError(pending.method, message.error.message));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (message.method === "Target.detachedFromTarget") {
      const detachedSessionId = (message.params as { sessionId?: string })
        ?.sessionId;
      if (detachedSessionId) this.sessions.delete(detachedSessionId);
      return;
    }

    if (!message.sessionId || !message.method) return;
    const listeners = this.sessions.get(message.sessionId)?.get(message.method);
    for (const listener of listeners ?? []) listener(message.params);
  }

  private disconnect(socket: WebSocket | null, error: Error): void {
    if (!socket || this.socket !== socket) return;
    this.socket = null;
    this.websocketUrl = null;
    this.sessions.clear();
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

class AttachedNetworkCdpSession implements NetworkCdpSession {
  constructor(
    private readonly sidecar: NetworkCdpSidecar,
    private readonly sessionId: string,
  ) {}

  get connected(): boolean {
    return this.sidecar.hasSession(this.sessionId);
  }

  detach(): Promise<void> {
    return this.sidecar.detach(this.sessionId);
  }

  off(event: string, listener: CdpEventListener): void {
    this.sidecar.off(this.sessionId, event, listener);
  }

  on(event: string, listener: CdpEventListener): void {
    this.sidecar.on(this.sessionId, event, listener);
  }

  send<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<T> {
    return this.sidecar.sendToSession<T>(this.sessionId, method, params);
  }
}

function connectionError(cause: unknown): DriverError {
  return new DriverError("Failed to connect the network capture CDP sidecar.", {
    cause,
    code: "network_sidecar_connect_failed",
  });
}

function commandError(method: string, cause: unknown): DriverError {
  return new DriverError(`Network capture CDP command ${method} failed.`, {
    cause,
    code: "network_sidecar_command_failed",
  });
}
