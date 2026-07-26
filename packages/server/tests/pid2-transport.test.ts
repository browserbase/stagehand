import { describe, expect, it, vi } from "vitest";
import {
  createPid2WebSocketFactory,
  parseStagehandActivationMessage,
  StagehandPid2InactiveError,
} from "../service-worker-lifecycle/pid2-transport.js";
import { CdpConnection, type CdpWebSocketTransport } from "../understudy/cdp.js";

class FakeTransport implements CdpWebSocketTransport {
  connected = true;
  sent: string[] = [];
  close = vi.fn(async () => {
    this.connected = false;
  });
  private readonly messageHandlers = new Set<(data: string) => void>();
  private readonly closeHandlers: Array<(event: { code: number; reason: string }) => void> = [];
  private readonly errorHandlers: Array<(error: Error) => void> = [];

  send(payload: string): void {
    this.sent.push(payload);
  }

  onMessage(handler: (data: string) => void): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onClose(handler: (event: { code: number; reason: string }) => void): void {
    this.closeHandlers.push(handler);
  }

  onError(handler: (error: Error) => void): void {
    this.errorHandlers.push(handler);
  }

  receive(data: string): void {
    for (const handler of this.messageHandlers) handler(data);
  }
}

const activeFrame = JSON.stringify({
  type: "stagehand.activation",
  protocolVersion: "1",
  state: "active",
  activationEpoch: "reservation-a",
});

describe("pid2 resident WebSocket transport", () => {
  it("validates active and inactive control frames", () => {
    expect(parseStagehandActivationMessage(activeFrame)).toStrictEqual({
      type: "stagehand.activation",
      protocolVersion: "1",
      state: "active",
      activationEpoch: "reservation-a",
    });
    expect(
      parseStagehandActivationMessage(
        JSON.stringify({
          type: "stagehand.activation",
          protocolVersion: "1",
          state: "inactive",
        }),
      ),
    ).toStrictEqual({
      type: "stagehand.activation",
      protocolVersion: "1",
      state: "inactive",
    });
    expect(() =>
      parseStagehandActivationMessage(
        JSON.stringify({
          type: "stagehand.activation",
          protocolVersion: "1",
          state: "active",
        }),
      ),
    ).toThrow();
  });

  it("consumes the activation frame before raw CDP begins on the same socket", async () => {
    const transport = new FakeTransport();
    const onActivation = vi.fn();
    const factory = createPid2WebSocketFactory(async () => transport, onActivation);
    const connectionPromise = CdpConnection.connect("ws://pid2.test", factory, {
      debug: () => {},
      error: () => {},
    });
    await Promise.resolve();
    transport.receive(activeFrame);
    const connection = await connectionPromise;

    expect(onActivation).toHaveBeenCalledOnce();
    expect(onActivation).toHaveBeenCalledWith(
      expect.objectContaining({ activationEpoch: "reservation-a" }),
    );

    const version = connection.send<{ product: string }>("Browser.getVersion");
    const request = JSON.parse(transport.sent[0]!) as { id: number };
    transport.receive(JSON.stringify({ id: request.id, result: { product: "Chrome/Test" } }));
    await expect(version).resolves.toStrictEqual({ product: "Chrome/Test" });
  });

  it("closes without exposing CDP when pid2 reports inactive", async () => {
    const transport = new FakeTransport();
    const onActivation = vi.fn();
    const factory = createPid2WebSocketFactory(async () => transport, onActivation);
    const connection = CdpConnection.connect("ws://pid2.test", factory, {
      debug: () => {},
      error: () => {},
    });
    await Promise.resolve();
    transport.receive(
      JSON.stringify({
        type: "stagehand.activation",
        protocolVersion: "1",
        state: "inactive",
      }),
    );

    await expect(connection).rejects.toBeInstanceOf(StagehandPid2InactiveError);
    expect(onActivation).not.toHaveBeenCalled();
    expect(transport.sent).toStrictEqual([]);
    expect(transport.close).toHaveBeenCalledOnce();
  });
});
