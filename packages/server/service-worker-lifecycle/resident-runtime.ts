import { STAGEHAND_PROTOCOL_VERSION, STAGEHAND_RUNTIME_VERSION } from "../../protocol/schemas.js";
import type {
  RuntimeDescriptor,
  StagehandInitParams,
  StagehandInitResult,
} from "../../protocol/types.js";
import type { StagehandRuntime } from "../runtime.js";
import { STAGEHAND_PID2_WEBSOCKET_URL, StagehandPid2InactiveError } from "./pid2-transport.js";

export type ResidentRuntimeState =
  | "inactive"
  | "connecting"
  | "bootstrapping"
  | "ready"
  | "reconnecting"
  | "failed";

export type StagehandRuntimeMarker = RuntimeDescriptor & {
  name: "stagehand";
  version: string;
  state: ResidentRuntimeState;
  connected: boolean;
  activationEpoch?: string;
  runtimeInstanceId: string;
  timings: {
    connectAndBootstrapMs?: number;
    totalMs?: number;
  };
  failure?: {
    phase: "connecting" | "bootstrapping" | "reconnecting";
    message: string;
  };
};

type ResidentRuntimeFailurePhase = NonNullable<StagehandRuntimeMarker["failure"]>["phase"];

export type ResidentRuntimeLifecycleOptions = {
  resolveResidentWebSocketUrl?: () => Promise<string>;
  waitForRpcReceiver?: () => Promise<void>;
  onActive?: () => void | Promise<void>;
  onInactive?: () => void | Promise<void>;
  now?: () => number;
  startedAt?: number;
  runtimeInstanceId?: string;
  reconnectDelaysMs?: readonly number[];
};

class StagehandActivationEpochChangedError extends Error {
  constructor(readonly nextActivationEpoch: string) {
    super("pid2 activation epoch changed while replacing the resident browser session");
    this.name = "StagehandActivationEpochChangedError";
  }
}

const DEFAULT_RECONNECT_DELAYS_MS = [100, 250, 500] as const;

/** Owns the service worker's serialized resident CDP bootstrap/reset lifecycle. */
export class ResidentRuntimeLifecycle {
  readonly marker: StagehandRuntimeMarker;
  private readonly now: () => number;
  private readonly startedAt: number;
  private readonly reconnectDelaysMs: readonly number[];
  private operationGeneration = 0;
  private connectionAttempt = 0;
  private operationTail: Promise<void> = Promise.resolve();
  private bootstrapPromise?: Promise<void>;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private reconnectAttempt = 0;
  private mode: "resident" | "client-cdp" = "resident";

  constructor(
    private readonly runtime: StagehandRuntime,
    private readonly options: ResidentRuntimeLifecycleOptions = {},
  ) {
    this.now = options.now ?? (() => performance.now());
    this.startedAt = options.startedAt ?? this.now();
    this.reconnectDelaysMs = options.reconnectDelaysMs ?? DEFAULT_RECONNECT_DELAYS_MS;
    this.marker = {
      name: "stagehand",
      version: STAGEHAND_RUNTIME_VERSION,
      protocolVersion: STAGEHAND_PROTOCOL_VERSION,
      serverInfo: {
        name: "stagehand",
        version: STAGEHAND_RUNTIME_VERSION,
      },
      state: "connecting",
      connected: false,
      runtimeInstanceId: options.runtimeInstanceId ?? crypto.randomUUID(),
      timings: {},
    };
  }

  bootstrap(): Promise<void> {
    if (this.mode !== "resident") return Promise.resolve();
    if (this.marker.state === "ready" && this.runtime.loopbackStatus().connected) {
      return Promise.resolve();
    }
    if (this.bootstrapPromise) return this.bootstrapPromise;

    const generation = this.operationGeneration;
    const operation = this.enqueue(() => this.runResidentBootstrap(generation));
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

    if (params.browserCdpUrl) {
      const generation = this.beginClientCdpOperation();
      return this.enqueue(() =>
        this.runConfiguredInitialization(generation, params, params.browserCdpUrl!),
      );
    }

    const generation = this.operationGeneration;
    return this.enqueue(async () => {
      if (generation !== this.operationGeneration || this.mode !== "resident") {
        throw new Error("Resident runtime bootstrap was superseded");
      }
      if (this.marker.state !== "ready" || !this.runtime.loopbackStatus().connected) {
        throw new Error("Resident runtime is not ready for stagehand.init");
      }
      return await this.runtime.initialize(params);
    });
  }

  reset(): Promise<void> {
    this.clearReconnectTimer();
    this.mode = "resident";
    const generation = ++this.operationGeneration;
    this.connectionAttempt += 1;
    this.bootstrapPromise = undefined;
    return this.enqueue(async () => {
      await this.runtime.resetForReservation();
      await this.options.onInactive?.();
      delete this.marker.activationEpoch;
      if (generation !== this.operationGeneration) return;
      await this.runResidentBootstrap(generation);
    });
  }

  private beginClientCdpOperation(): number {
    this.clearReconnectTimer();
    this.mode = "client-cdp";
    this.bootstrapPromise = undefined;
    this.connectionAttempt += 1;
    const generation = ++this.operationGeneration;
    delete this.marker.activationEpoch;
    this.publish("connecting", false, {});
    return generation;
  }

  private enqueue<Result>(operation: () => Promise<Result>): Promise<Result> {
    const result = this.operationTail.then(operation, operation);
    this.operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async runConfiguredInitialization(
    generation: number,
    params: StagehandInitParams,
    browserCdpUrl: string,
  ): Promise<StagehandInitResult> {
    await this.runtime.resetForReservation();
    if (generation !== this.operationGeneration) {
      throw new Error("Stagehand browser session bootstrap was superseded");
    }

    const connectionAttempt = ++this.connectionAttempt;
    const connectStartedAt = this.now();
    await this.options.onActive?.();
    await this.runtime.configureLoopback(
      { cdpUrl: browserCdpUrl },
      {
        onConnected: () => {
          if (this.isCurrent(generation, connectionAttempt)) {
            this.publish("bootstrapping", true, {});
          }
        },
        onDisconnected: () => {
          if (this.isCurrent(generation, connectionAttempt)) {
            this.publishFailure("bootstrapping", "Client-provided CDP connection closed");
          }
        },
      },
    );

    if (!this.isCurrent(generation, connectionAttempt)) {
      await this.runtime.resetForReservation();
      throw new Error("Stagehand browser session bootstrap was superseded");
    }
    if (!this.runtime.loopbackStatus().connected) {
      await this.runtime.resetForReservation();
      throw new Error("Stagehand browser session disconnected during bootstrap");
    }

    await this.options.waitForRpcReceiver?.();
    const result = await this.runtime.initialize(params);
    this.publish("ready", true, {
      connectAndBootstrapMs: this.now() - connectStartedAt,
      totalMs: this.now() - this.startedAt,
    });
    return result;
  }

  private async runResidentBootstrap(generation: number): Promise<void> {
    if (generation !== this.operationGeneration || this.mode !== "resident") return;

    const connectionAttempt = ++this.connectionAttempt;
    const connectStartedAt = this.now();
    this.publish(this.marker.activationEpoch ? "reconnecting" : "connecting", false, {});

    try {
      const cdpUrl = await (this.options.resolveResidentWebSocketUrl?.() ??
        Promise.resolve(STAGEHAND_PID2_WEBSOCKET_URL));
      if (!this.isCurrent(generation, connectionAttempt)) return;

      await this.runtime.configureLoopback(
        { cdpUrl },
        {
          onActivation: async (activationEpoch) => {
            if (!this.isCurrent(generation, connectionAttempt)) {
              throw new Error("Resident runtime bootstrap was superseded");
            }
            if (this.marker.activationEpoch && this.marker.activationEpoch !== activationEpoch) {
              throw new StagehandActivationEpochChangedError(activationEpoch);
            }
            this.marker.activationEpoch = activationEpoch;
            await this.options.onActive?.();
          },
          onConnected: () => {
            if (this.isCurrent(generation, connectionAttempt)) {
              this.publish("bootstrapping", true, {});
            }
          },
          onDisconnected: () => {
            if (this.isCurrent(generation, connectionAttempt)) {
              this.handleResidentDisconnect();
            }
          },
        },
      );

      if (!this.isCurrent(generation, connectionAttempt)) {
        await this.runtime.resetForReservation();
        return;
      }
      if (!this.marker.activationEpoch) {
        await this.runtime.resetForReservation();
        throw new Error("pid2 did not provide an activation epoch");
      }
      if (!this.runtime.loopbackStatus().connected) {
        await this.runtime.resetForReservation();
        throw new Error("Resident runtime disconnected during bootstrap");
      }

      await this.options.waitForRpcReceiver?.();
      if (!this.isCurrent(generation, connectionAttempt)) return;

      this.clearReconnectTimer();
      this.reconnectAttempt = 0;
      this.publish("ready", true, {
        connectAndBootstrapMs: this.now() - connectStartedAt,
        totalMs: this.now() - this.startedAt,
      });
    } catch (error) {
      if (error instanceof StagehandPid2InactiveError) {
        await this.becomeInactive(generation);
        return;
      }
      if (error instanceof StagehandActivationEpochChangedError) {
        await this.runtime.resetForReservation();
        if (generation !== this.operationGeneration || this.mode !== "resident") return;
        this.marker.activationEpoch = error.nextActivationEpoch;
        const nextGeneration = ++this.operationGeneration;
        await this.runResidentBootstrap(nextGeneration);
        return;
      }
      if (generation === this.operationGeneration && this.mode === "resident") {
        this.publishFailure(
          this.marker.state === "bootstrapping" ? "bootstrapping" : "connecting",
          error instanceof Error ? error.message : String(error),
        );
      }
      throw error;
    }
  }

  private async becomeInactive(generation: number): Promise<void> {
    this.clearReconnectTimer();
    await this.runtime.resetForReservation();
    if (generation !== this.operationGeneration || this.mode !== "resident") return;
    delete this.marker.activationEpoch;
    this.publish("inactive", false, {});
    await this.options.onInactive?.();
  }

  private handleResidentDisconnect(): void {
    this.marker.connected = false;
    if (this.mode !== "resident") return;
    this.publish("reconnecting", false, this.marker.timings);
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.mode !== "resident") return;
    const delay = this.reconnectDelaysMs[this.reconnectAttempt];
    if (delay === undefined) {
      this.publishFailure("reconnecting", "Resident pid2 reconnect budget exhausted");
      return;
    }
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (this.mode !== "resident") return;
      this.bootstrapPromise = undefined;
      this.operationGeneration += 1;
      void this.bootstrap().catch(() => this.scheduleReconnect());
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.reconnectAttempt = 0;
  }

  private isCurrent(generation: number, connectionAttempt: number): boolean {
    return generation === this.operationGeneration && connectionAttempt === this.connectionAttempt;
  }

  private publish(
    state: ResidentRuntimeState,
    connected: boolean,
    timings: StagehandRuntimeMarker["timings"],
  ): void {
    this.marker.state = state;
    this.marker.connected = connected;
    this.marker.timings = timings;
    delete this.marker.failure;
  }

  private publishFailure(phase: ResidentRuntimeFailurePhase, message: string): void {
    this.marker.state = "failed";
    this.marker.connected = false;
    this.marker.failure = { phase, message };
  }
}
