import { STAGEHAND_PROTOCOL_VERSION, STAGEHAND_RUNTIME_VERSION } from "../../protocol/schemas.js";
import type {
  RuntimeDescriptor,
  StagehandInitParams,
  StagehandInitResult,
} from "../../protocol/types.js";
import type { StagehandRuntime } from "../runtime.js";

export type ResidentRuntimeState =
  | "unconfigured"
  | "connecting"
  | "bootstrapping"
  | "ready"
  | "reconnecting"
  | "failed"
  | "closed";

export type StagehandRuntimeMarker = RuntimeDescriptor & {
  name: "stagehand";
  version: string;
  state: ResidentRuntimeState;
  connected: boolean;
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
  now?: () => number;
  startedAt?: number;
  runtimeInstanceId?: string;
  reconnectDelaysMs?: readonly number[];
};

const DEFAULT_RECONNECT_DELAYS_MS = [100, 250, 500] as const;

/** Coordinates one browser VM's resident connection and same-session reconnects. */
export class ResidentRuntimeLifecycle {
  readonly marker: StagehandRuntimeMarker;
  private readonly now: () => number;
  private readonly startedAt: number;
  private readonly reconnectDelaysMs: readonly number[];
  private operationGeneration = 0;
  private operationTail: Promise<void> = Promise.resolve();
  private bootstrapPromise?: Promise<void>;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private reconnectAttempt = 0;
  private closed = false;

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
      state: options.resolveResidentWebSocketUrl ? "connecting" : "unconfigured",
      connected: false,
      runtimeInstanceId: options.runtimeInstanceId ?? crypto.randomUUID(),
      timings: {},
    };
  }

  bootstrap(): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (!this.options.resolveResidentWebSocketUrl) {
      return Promise.reject(new Error("Resident browser proxy is not configured"));
    }
    if (this.marker.state === "ready" && this.runtime.loopbackStatus().connected) {
      return Promise.resolve();
    }
    if (this.bootstrapPromise) return this.bootstrapPromise;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
      this.operationGeneration += 1;
    }

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

    const bootstrap = this.bootstrap();
    const generation = this.operationGeneration;
    return this.enqueue(async () => {
      await bootstrap;
      if (generation !== this.operationGeneration || this.closed) {
        throw new Error("Resident runtime bootstrap was superseded");
      }
      if (this.marker.state !== "ready" || !this.runtime.loopbackStatus().connected) {
        throw new Error("Resident runtime is not ready for stagehand.init");
      }
      return await this.runtime.initialize(params);
    });
  }

  close(): Promise<void> {
    this.cancelReconnects();
    this.closed = true;
    this.bootstrapPromise = undefined;
    ++this.operationGeneration;
    return this.enqueue(async () => {
      await this.runtime.close();
      this.publish("closed", false, {});
    });
  }

  private enqueue<Result>(operation: () => Promise<Result>): Promise<Result> {
    const result = this.operationTail.then(operation, operation);
    this.operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async runResidentBootstrap(generation: number): Promise<void> {
    if (generation !== this.operationGeneration || this.closed) return;

    const resolveResidentWebSocketUrl = this.options.resolveResidentWebSocketUrl;
    if (!resolveResidentWebSocketUrl) throw new Error("Resident browser proxy is not configured");

    const connectStartedAt = this.now();
    const reconnecting = this.reconnectAttempt > 0 || this.marker.state === "reconnecting";
    this.publish(reconnecting ? "reconnecting" : "connecting", false, {});

    try {
      const cdpUrl = await resolveResidentWebSocketUrl();
      if (!this.isCurrent(generation)) return;

      await this.runtime.configureLoopback(
        { cdpUrl },
        {
          bootstrapMode: "resident",
          onConnected: () => {
            if (this.isCurrent(generation)) {
              this.publish("bootstrapping", true, {});
            }
          },
          onDisconnected: () => {
            if (this.isCurrent(generation)) this.handleResidentDisconnect();
          },
        },
      );

      if (!this.isCurrent(generation)) return;
      if (!this.runtime.loopbackStatus().connected) {
        throw new Error("Resident runtime disconnected during bootstrap");
      }

      await this.runtime.restoreInitializedBrowserSession();
      this.assertConnected(generation);
      await this.options.waitForRpcReceiver?.();
      this.assertConnected(generation);

      this.cancelReconnects();
      this.publish("ready", true, {
        connectAndBootstrapMs: this.now() - connectStartedAt,
        totalMs: this.now() - this.startedAt,
      });
    } catch (error) {
      if (this.isCurrent(generation) && !this.closed) {
        const phase = this.marker.state === "bootstrapping" ? "bootstrapping" : "connecting";
        if (this.scheduleReconnect()) {
          this.publish("reconnecting", false, this.marker.timings);
        } else {
          this.publishFailure(phase, `Resident runtime ${phase} failed`);
        }
      }
      throw error;
    }
  }

  private assertConnected(generation: number): void {
    if (!this.isCurrent(generation)) {
      throw new Error("Stagehand browser session bootstrap was superseded");
    }
    if (!this.runtime.loopbackStatus().connected) {
      throw new Error("Stagehand browser session disconnected during bootstrap");
    }
  }

  private handleResidentDisconnect(): void {
    this.publish("reconnecting", false, this.marker.timings);
    this.scheduleReconnect();
  }

  private scheduleReconnect(): boolean {
    if (this.reconnectTimer || this.closed) return Boolean(this.reconnectTimer);
    const delay = this.reconnectDelaysMs[this.reconnectAttempt];
    if (delay === undefined) {
      this.publishFailure("reconnecting", "Resident runtime reconnect budget exhausted");
      return false;
    }

    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (this.closed) return;
      this.bootstrapPromise = undefined;
      this.operationGeneration += 1;
      void this.bootstrap().catch(() => {});
    }, delay);
    return true;
  }

  private cancelReconnects(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.reconnectAttempt = 0;
  }

  private isCurrent(generation: number): boolean {
    return generation === this.operationGeneration;
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
