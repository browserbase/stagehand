import { STAGEHAND_SEND_TO_HOST_BINDING } from "@browserbasehq/stagehand-protocol/schema-registry";
import type { CdpWebSocketCloseEvent, CdpWebSocketFactory, CdpWebSocketTransport } from "./cdp.js";

type HostRelayEvent =
  | { id: string; type: "open" }
  | { id: string; type: "message"; data: string }
  | { id: string; type: "error" }
  | { id: string; type: "close"; code: number; reason: string };

const transports = new Map<string, HostRelayTransport>();
const scope = globalThis as typeof globalThis & {
  __stagehandHostRelayReceive?: (event: HostRelayEvent) => void;
  [STAGEHAND_SEND_TO_HOST_BINDING]?: (payload: string) => void;
};

scope.__stagehandHostRelayReceive = (event) => transports.get(event.id)?.receive(event);

class HostRelayTransport implements CdpWebSocketTransport {
  readonly id = crypto.randomUUID();
  readonly messageHandlers = new Set<(data: string) => void>();
  readonly closeHandlers = new Set<(event: CdpWebSocketCloseEvent) => void>();
  readonly errorHandlers = new Set<(error: Error) => void>();
  connected = false;
  openResolve?: () => void;
  openReject?: (error: Error) => void;

  async open(): Promise<void> {
    transports.set(this.id, this);
    const opened = new Promise<void>((resolve, reject) => {
      this.openResolve = resolve;
      this.openReject = reject;
    });
    try {
      this.notifyHost({ type: "open" });
    } catch (error) {
      transports.delete(this.id);
      throw error;
    }
    try {
      await opened;
    } catch (error) {
      transports.delete(this.id);
      throw error;
    }
  }

  send(payload: string): void {
    if (!this.connected) throw new Error("Host CDP relay is closed");
    this.notifyHost({ type: "send", data: payload });
  }

  async close(): Promise<void> {
    if (!transports.delete(this.id)) return;
    this.connected = false;
    this.notifyHost({ type: "close" });
  }

  onMessage(handler: (data: string) => void): void {
    this.messageHandlers.add(handler);
  }

  onClose(handler: (event: CdpWebSocketCloseEvent) => void): void {
    this.closeHandlers.add(handler);
  }

  onError(handler: (error: Error) => void): void {
    this.errorHandlers.add(handler);
  }

  receive(event: HostRelayEvent): void {
    if (event.type === "open") {
      this.connected = true;
      this.openResolve?.();
      this.openResolve = undefined;
      this.openReject = undefined;
    } else if (event.type === "message") {
      for (const handler of this.messageHandlers) handler(event.data);
    } else if (event.type === "error") {
      this.connected = false;
      transports.delete(this.id);
      const error = new Error("Host CDP relay failed");
      this.openReject?.(error);
      this.openReject = undefined;
      for (const handler of this.errorHandlers) handler(error);
    } else {
      this.connected = false;
      transports.delete(this.id);
      this.openReject?.(new Error("Host CDP relay closed before opening"));
      this.openReject = undefined;
      for (const handler of this.closeHandlers) handler(event);
    }
  }

  notifyHost(message: { type: "open" | "close" } | { type: "send"; data: string }): void {
    const binding = scope[STAGEHAND_SEND_TO_HOST_BINDING];
    if (!binding) throw new Error("Stagehand host binding is unavailable");
    binding(JSON.stringify({ kind: "stagehand.host_cdp_relay", id: this.id, ...message }));
  }
}

export const hostRelayWebSocketFactory: CdpWebSocketFactory = async () => {
  const transport = new HostRelayTransport();
  await transport.open();
  return transport;
};
