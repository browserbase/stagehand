import { STAGEHAND_PROTOCOL_VERSION } from "../../protocol/schemas.js";
import type {
  RuntimeDescriptor,
  StagehandInitParams,
  StagehandInitResult,
} from "../../protocol/types.js";
import type { StagehandRuntime } from "../runtime.js";
import { STAGEHAND_RUNTIME_VERSION } from "../version.js";

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
  private residentBootstrapEnabled = true;

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
      timings: {},
    };
  }

  bootstrap(): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (!this.residentBootstrapEnabled) {
      return Promise.reject(new Error("Resident browser connection is disabled"));
    }
    if (!this.options.resolveResidentWebSocketUrl) {
      return Promise.reject(new Error("Resident browser proxy is not configured"));
    }
    if (this.marker.state === "ready" && this.runtime.browserConnectionStatus().connected) {
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
      if (this.marker.state !== "ready" || !this.runtime.browserConnectionStatus().connected) {
        throw new Error("Resident runtime is not ready for stagehand.init");
      }
      return await this.runtime.initialize(params);
    });
  }

  async initializeWithBrowserCdpUrl(
    params: StagehandInitParams & { browserCdpUrl: string },
  ): Promise<StagehandInitResult> {
    if (this.runtime.state.getState().status !== "created") {
      throw new Error("Stagehand has already been initialized");
    }
    this.disableResidentBootstrap();
    await this.runtime.replaceBrowserConnection({ cdpUrl: params.browserCdpUrl });
    return await this.runtime.initialize(params);
  }

  async close(): Promise<void> {
    this.cancelReconnects();
    this.closed = true;
    this.residentBootstrapEnabled = false;
    this.bootstrapPromise = undefined;
    ++this.operationGeneration;
    await this.runtime.close();
    this.publish("closed", false, {});
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

      await this.runtime.replaceBrowserConnection(
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
      if (!this.runtime.browserConnectionStatus().connected) {
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
        const phase = reconnecting
          ? "reconnecting"
          : this.marker.state === "bootstrapping"
            ? "bootstrapping"
            : "connecting";
        if (this.scheduleReconnect()) {
          this.publish("reconnecting", false, this.marker.timings);
        } else if (this.marker.state !== "failed") {
          this.publishFailure(
            phase,
            phase === "reconnecting"
              ? "Resident runtime reconnect budget exhausted"
              : `Resident runtime ${phase} failed`,
          );
        }
      }
      throw error;
    }
  }

  private assertConnected(generation: number): void {
    if (!this.isCurrent(generation)) {
      throw new Error("Stagehand browser session bootstrap was superseded");
    }
    if (!this.runtime.browserConnectionStatus().connected) {
      throw new Error("Stagehand browser session disconnected during bootstrap");
    }
  }

  private handleResidentDisconnect(): void {
    this.publish("reconnecting", false, this.marker.timings);
    this.scheduleReconnect();
  }

  private scheduleReconnect(): boolean {
    if (this.reconnectTimer || this.closed || !this.residentBootstrapEnabled) {
      return Boolean(this.reconnectTimer);
    }
    const delay = this.reconnectDelaysMs[this.reconnectAttempt];
    if (delay === undefined) return false;

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
    return this.residentBootstrapEnabled && generation === this.operationGeneration;
  }

  private disableResidentBootstrap(): void {
    this.cancelReconnects();
    this.residentBootstrapEnabled = false;
    this.bootstrapPromise = undefined;
    ++this.operationGeneration;
    this.publish("unconfigured", false, {});
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
