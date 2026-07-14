import { z } from "zod/v4";
import {
  StagehandRuntimeError,
  type LoopbackCdpConnection,
  type LoopbackCdpConnectionFactory,
} from "../runtime.js";
import { browserWebSocketFactory } from "../understudy/browserWebSocketTransport.js";
import type { CdpWebSocketTransport } from "../understudy/cdp.js";

const CdpResponseSchema = z.object({
  id: z.number(),
  result: z.unknown().optional(),
  error: z
    .object({
      code: z.number(),
      message: z.string(),
      data: z.unknown().optional(),
    })
    .optional(),
});

type CdpResponse = z.infer<typeof CdpResponseSchema>;

type PendingCdpRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
};

class BrowserLoopbackCdpConnection implements LoopbackCdpConnection {
  #nextId = 1;
  #pending = new Map<number, PendingCdpRequest>();
  #messageQueue: Promise<void> = Promise.resolve();

  private constructor(private readonly transport: CdpWebSocketTransport) {
    this.transport.onMessage((data) => {
      this.#messageQueue = this.#messageQueue
        .then(() => this.handleMessage(data))
        .catch((error: unknown) => {
          const reason =
            error instanceof Error ? error : new Error("Failed to handle loopback CDP message");
          for (const pending of this.#pending.values()) {
            pending.reject(reason);
          }
          this.#pending.clear();
        });
    });

    this.transport.onClose(() => {
      this.rejectPending("Loopback CDP websocket closed");
    });

    this.transport.onError(() => {
      this.rejectPending("Loopback CDP websocket error");
    });
  }

  get connected(): boolean {
    return this.transport.connected;
  }

  static async connect(cdpUrl: string): Promise<BrowserLoopbackCdpConnection> {
    const transport = await browserWebSocketFactory(cdpUrl);
    return new BrowserLoopbackCdpConnection(transport);
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

      this.transport.send(JSON.stringify({ id, method, params }));
    });
  }

  close(): void {
    void this.transport.close();
  }

  private handleMessage(data: string): void {
    const message: CdpResponse = CdpResponseSchema.parse(JSON.parse(data));

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

export const browserLoopbackCdpFactory: LoopbackCdpConnectionFactory = (cdpUrl) =>
  BrowserLoopbackCdpConnection.connect(cdpUrl);
