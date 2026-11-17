import { STAGEHAND_SEND_TO_HOST_BINDING } from "@browserbasehq/stagehand-protocol/schema-registry";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hostRelayWebSocketFactory } from "./hostRelayTransport.js";

type RelayMessage = {
  kind: string;
  id: string;
  type: "open" | "send" | "close";
  data?: string;
};

type RelayEvent =
  | { id: string; type: "open" | "error" }
  | { id: string; type: "message"; data: string }
  | { id: string; type: "close"; code: number; reason: string };

const scope = globalThis as typeof globalThis & {
  __stagehandHostRelayReceive: (event: RelayEvent) => void;
};

function stubHost(onMessage: (message: RelayMessage) => void): void {
  vi.stubGlobal(STAGEHAND_SEND_TO_HOST_BINDING, (payload: string) => {
    onMessage(JSON.parse(payload) as RelayMessage);
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("host CDP relay transport", () => {
  it("routes CDP frames through the host without sending a URL or key", async () => {
    const sent: RelayMessage[] = [];
    stubHost((message) => {
      sent.push(message);
      if (message.type === "open") {
        queueMicrotask(() => scope.__stagehandHostRelayReceive({ id: message.id, type: "open" }));
      }
    });

    const transport = await hostRelayWebSocketFactory("stagehand-host-cdp-relay");
    const onMessage = vi.fn();
    transport.onMessage(onMessage);
    expect(transport.connected).toBe(true);

    const frame = JSON.stringify({ id: 1, method: "Target.getTargets" });
    transport.send(frame);
    expect(sent).toEqual([
      { kind: "stagehand.host_cdp_relay", id: sent[0]?.id, type: "open" },
      { kind: "stagehand.host_cdp_relay", id: sent[0]?.id, type: "send", data: frame },
    ]);
    expect(JSON.stringify(sent)).not.toMatch(/signingKey|Authorization|wss:\/\//);

    scope.__stagehandHostRelayReceive({
      id: sent[0]!.id,
      type: "message",
      data: JSON.stringify({ id: 1, result: {} }),
    });
    expect(onMessage).toHaveBeenCalledWith(JSON.stringify({ id: 1, result: {} }));

    await transport.close();
    expect(transport.connected).toBe(false);
    expect(sent.at(-1)).toEqual({
      kind: "stagehand.host_cdp_relay",
      id: sent[0]?.id,
      type: "close",
    });
  });

  it("rejects an upstream connection error", async () => {
    let relayId: string | undefined;
    stubHost((message) => {
      relayId = message.id;
      queueMicrotask(() => scope.__stagehandHostRelayReceive({ id: message.id, type: "error" }));
    });

    await expect(hostRelayWebSocketFactory("stagehand-host-cdp-relay")).rejects.toThrow(
      "Host CDP relay failed",
    );
    expect(relayId).toBeDefined();
  });
});
