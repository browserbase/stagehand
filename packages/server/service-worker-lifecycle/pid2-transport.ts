import { z } from "zod/v4";
import type { CdpWebSocketFactory, CdpWebSocketTransport } from "../understudy/cdp.js";

export const STAGEHAND_PID2_WEBSOCKET_URL = "ws://127.0.0.1:8083/stagehand/v1";
export const STAGEHAND_PID2_PROTOCOL_VERSION = "1";

const ActiveStagehandActivationMessageSchema = z.object({
  type: z.literal("stagehand.activation"),
  protocolVersion: z.literal(STAGEHAND_PID2_PROTOCOL_VERSION),
  state: z.literal("active"),
  activationEpoch: z.string().min(1),
});

const InactiveStagehandActivationMessageSchema = z.object({
  type: z.literal("stagehand.activation"),
  protocolVersion: z.literal(STAGEHAND_PID2_PROTOCOL_VERSION),
  state: z.literal("inactive"),
  activationEpoch: z.string().min(1).optional(),
});

export const StagehandActivationMessageSchema = z.discriminatedUnion("state", [
  ActiveStagehandActivationMessageSchema,
  InactiveStagehandActivationMessageSchema,
]);

export type StagehandActivationMessage = z.infer<typeof StagehandActivationMessageSchema>;
export type ActiveStagehandActivationMessage = z.infer<
  typeof ActiveStagehandActivationMessageSchema
>;

export class StagehandPid2InactiveError extends Error {
  constructor() {
    super("pid2 reported that Stagehand is inactive for this reservation");
    this.name = "StagehandPid2InactiveError";
  }
}

export function parseStagehandActivationMessage(raw: string): StagehandActivationMessage {
  return StagehandActivationMessageSchema.parse(JSON.parse(raw));
}

/**
 * Consumes pid2's activation control frame before exposing the socket as raw CDP.
 * The returned transport is the same socket, so one resident runtime owns one
 * pid2/CDP connection and the control frame can never reach CdpConnection.
 */
export function createPid2WebSocketFactory(
  websocketFactory: CdpWebSocketFactory,
  onActivation: (message: ActiveStagehandActivationMessage) => void | Promise<void>,
): CdpWebSocketFactory {
  let used = false;

  return async (url) => {
    if (used) throw new Error("The pid2 resident WebSocket factory can only create one socket");
    used = true;

    const transport = await websocketFactory(url);
    try {
      const activation = parseStagehandActivationMessage(await firstMessage(transport));
      if (activation.state === "inactive") {
        throw new StagehandPid2InactiveError();
      }
      await onActivation(activation);
      return transport;
    } catch (error) {
      await transport.close().catch(() => {});
      throw error;
    }
  };
}

async function firstMessage(transport: CdpWebSocketTransport): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    let settled = false;
    let unsubscribe: (() => void) | undefined;
    const onMessage = (data: string) => {
      if (settled) return;
      settled = true;
      unsubscribe?.();
      resolve(data);
    };
    unsubscribe = transport.onMessage(onMessage);
    if (settled) unsubscribe();
    transport.onError((error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    transport.onClose((event) => {
      if (settled) return;
      settled = true;
      reject(
        new Error(
          `pid2 WebSocket closed before activation (code=${String(event.code)}, reason=${event.reason})`,
        ),
      );
    });
  });
}
