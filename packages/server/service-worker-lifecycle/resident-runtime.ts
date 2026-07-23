import { STAGEHAND_PROTOCOL_VERSION, STAGEHAND_RUNTIME_VERSION } from "../../protocol/schemas.js";
import type { RuntimeDescriptor } from "../../protocol/types.js";
import type { StagehandRuntime } from "../runtime.js";

export type ResidentRuntimeState =
  | "starting"
  | "resolving-cdp"
  | "connecting-cdp"
  | "bootstrapping"
  | "disconnected"
  | "ready";

export type StagehandRuntimeMarker = RuntimeDescriptor & {
  state: ResidentRuntimeState;
  connected: boolean;
  timings: {
    resolveMs?: number;
    connectAndBootstrapMs?: number;
    totalMs?: number;
  };
};

export type ResidentRuntimeLifecycleOptions = {
  resolveDebuggerUrl(): Promise<string>;
  now?: () => number;
  startedAt?: number;
};

/** Owns the service worker's serialized resident CDP bootstrap/reset lifecycle. */
export class ResidentRuntimeLifecycle {
  readonly marker: StagehandRuntimeMarker;
  private readonly now: () => number;
  private readonly startedAt: number;
  private generation = 0;
  private operationTail: Promise<void> = Promise.resolve();
  private bootstrapPromise?: Promise<void>;
  private autoBootstrapEnabled = true;

  constructor(
    private readonly runtime: StagehandRuntime,
    private readonly options: ResidentRuntimeLifecycleOptions,
  ) {
    this.now = options.now ?? (() => performance.now());
    this.startedAt = options.startedAt ?? this.now();
    this.marker = {
      protocolVersion: STAGEHAND_PROTOCOL_VERSION,
      serverInfo: {
        name: "stagehand",
        version: STAGEHAND_RUNTIME_VERSION,
      },
      state: "starting",
      connected: false,
      timings: {},
    };
  }

  bootstrap(): Promise<void> {
    if (!this.autoBootstrapEnabled) return Promise.resolve();
    if (this.marker.state === "ready" && this.runtime.loopbackStatus().connected) {
      return Promise.resolve();
    }
    if (this.bootstrapPromise) return this.bootstrapPromise;

    const generation = this.generation;
    const operation = this.enqueue(() => this.runBootstrap(generation, false));
    const tracked = operation.finally(() => {
      if (this.bootstrapPromise === tracked) this.bootstrapPromise = undefined;
    });
    this.bootstrapPromise = tracked;
    return tracked;
  }

  /** Gives an explicit runtime.configure call ownership of the browser connection. */
  disableAutoBootstrap(): void {
    this.autoBootstrapEnabled = false;
    ++this.generation;
    this.bootstrapPromise = undefined;
    this.publish("disconnected", false, this.marker.timings);
  }

  reset(): Promise<void> {
    this.autoBootstrapEnabled = true;
    const generation = ++this.generation;
    this.bootstrapPromise = undefined;
    return this.enqueue(() => this.runBootstrap(generation, true));
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const guardedOperation = async () => {
      try {
        await operation();
      } catch (error) {
        this.marker.connected = false;
        throw error;
      }
    };
    const result = this.operationTail.then(guardedOperation, guardedOperation);
    this.operationTail = result.catch(() => {});
    return result;
  }

  private async runBootstrap(generation: number, reset: boolean): Promise<void> {
    if (reset) await this.runtime.resetForReservation();
    if (generation !== this.generation) return;

    this.publish("resolving-cdp", false, {});
    const resolveStartedAt = this.now();
    const cdpUrl = await this.options.resolveDebuggerUrl();
    const resolveMs = this.now() - resolveStartedAt;
    if (generation !== this.generation) return;

    this.publish("connecting-cdp", false, { resolveMs });
    let connectStartedAt = this.now();
    await this.runtime.configureLoopback(
      { cdpUrl },
      {
        onConnecting: () => {
          connectStartedAt = this.now();
        },
        onConnected: () => {
          if (generation === this.generation) {
            this.publish("bootstrapping", true, { resolveMs });
          }
        },
        onDisconnected: () => {
          if (generation === this.generation) {
            this.publish("disconnected", false, this.marker.timings);
          }
        },
      },
    );

    if (generation !== this.generation) {
      await this.runtime.resetForReservation();
      return;
    }
    if (!this.runtime.loopbackStatus().connected) {
      await this.runtime.resetForReservation();
      throw new Error("Resident runtime disconnected during bootstrap");
    }

    this.publish("ready", true, {
      resolveMs,
      connectAndBootstrapMs: this.now() - connectStartedAt,
      totalMs: this.now() - this.startedAt,
    });
  }

  private publish(
    state: ResidentRuntimeState,
    connected: boolean,
    timings: StagehandRuntimeMarker["timings"],
  ): void {
    this.marker.state = state;
    this.marker.connected = connected;
    this.marker.timings = timings;
  }
}
