import { STAGEHAND_PROTOCOL_VERSION, STAGEHAND_RUNTIME_VERSION } from "../../protocol/schemas.js";
import type {
  BrowserConnection,
  RuntimeDescriptor,
  StagehandInitParams,
  StagehandInitResult,
} from "../../protocol/types.js";
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

  initialize(params: StagehandInitParams): Promise<StagehandInitResult> {
    if (this.runtime.state.getState().status !== "created") {
      return Promise.reject(new Error("Stagehand has already been initialized"));
    }

    if (params.browserConnection) {
      const browserConnection = params.browserConnection;
      this.autoBootstrapEnabled = false;
      const generation = ++this.generation;
      this.bootstrapPromise = undefined;
      this.publish("disconnected", false, this.marker.timings);
      return this.enqueue(() =>
        this.runConfiguredInitialization(generation, params, browserConnection),
      );
    }

    const generation = this.generation;
    return this.enqueue(async () => {
      if (generation !== this.generation || !this.autoBootstrapEnabled) {
        throw new Error("Resident runtime bootstrap was superseded");
      }
      if (this.marker.state !== "ready" || !this.runtime.loopbackStatus().connected) {
        await this.runBootstrap(generation, false);
      }
      return await this.runtime.initialize(params);
    });
  }

  reset(): Promise<void> {
    this.autoBootstrapEnabled = true;
    const generation = ++this.generation;
    this.bootstrapPromise = undefined;
    return this.enqueue(() => this.runBootstrap(generation, true));
  }

  private enqueue<Result>(operation: () => Promise<Result>): Promise<Result> {
    const guardedOperation = async () => {
      try {
        return await operation();
      } catch (error) {
        this.marker.connected = false;
        throw error;
      }
    };
    const result = this.operationTail.then(guardedOperation, guardedOperation);
    this.operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async runConfiguredInitialization(
    generation: number,
    params: StagehandInitParams,
    browserConnection: BrowserConnection,
  ): Promise<StagehandInitResult> {
    if (this.runtime.state.getState().status !== "created") {
      throw new Error("Stagehand has already been initialized");
    }

    await this.runtime.resetForReservation();
    if (generation !== this.generation) {
      throw new Error("Stagehand browser session bootstrap was superseded");
    }

    this.publish("connecting-cdp", false, {});
    let connectStartedAt = this.now();
    await this.runtime.configureLoopback(browserConnection, {
      onConnecting: () => {
        connectStartedAt = this.now();
      },
      onConnected: () => {
        if (generation === this.generation) this.publish("bootstrapping", true, {});
      },
      onDisconnected: () => {
        if (generation === this.generation) {
          this.publish("disconnected", false, this.marker.timings);
        }
      },
    });

    if (generation !== this.generation) {
      await this.runtime.resetForReservation();
      throw new Error("Stagehand browser session bootstrap was superseded");
    }
    if (!this.runtime.loopbackStatus().connected) {
      await this.runtime.resetForReservation();
      throw new Error("Stagehand browser session disconnected during bootstrap");
    }

    const result = await this.runtime.initialize(params);
    this.publish("ready", true, {
      connectAndBootstrapMs: this.now() - connectStartedAt,
      totalMs: this.now() - this.startedAt,
    });
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
