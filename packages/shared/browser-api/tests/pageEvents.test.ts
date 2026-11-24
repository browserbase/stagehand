import { describe, expect, expectTypeOf, it } from "vitest";
import type { z } from "zod/v4";
import type { RPCMethod } from "@browserbasehq/stagehand-protocol/json-rpc/schemas";
import { StagehandMethods } from "@browserbasehq/stagehand-protocol/schema-registry";
import type {
  PageCDPEvent,
  PageEventName,
  StagehandRpcNotification,
} from "@browserbasehq/stagehand-protocol/types";
import type { StagehandCommandClient } from "../src/commandClient.js";
import { Page, type CDPSubscription } from "../src/page.js";
import { Response } from "../src/response.js";

class FakeEventClient implements StagehandCommandClient {
  readonly calls: Array<{ method: string; params: unknown }> = [];
  readonly listeners = new Set<(notification: StagehandRpcNotification) => void>();

  async send<Method extends RPCMethod>(
    method: Method,
    params: z.input<Method["params"]>,
  ): Promise<z.output<Method["result"]>> {
    this.calls.push({ method: method.name, params });
    return { ok: true } as z.output<Method["result"]>;
  }

  onNotification(listener: (notification: StagehandRpcNotification) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(notification: StagehandRpcNotification): void {
    for (const listener of this.listeners) listener(notification);
  }

  subscriptionIds(): Array<{ event: string; subscriptionId: string }> {
    return this.calls
      .filter((call) => call.method === StagehandMethods.pageOn.name)
      .map((call) => call.params as { event: string; subscriptionId: string });
  }
}

function cdpEvent(method: PageCDPEvent["method"], text: string): PageCDPEvent {
  return {
    pageId: "page-1",
    method,
    params: { text },
    sessionId: "session-1",
    targetId: "target-1",
  };
}

function cdpNotification(subscriptionId: string, event: PageCDPEvent): StagehandRpcNotification {
  return { jsonrpc: "2.0", method: "page.cdp_event", params: { subscriptionId, event } };
}

function responseNotification(subscriptionId: string): StagehandRpcNotification {
  return {
    jsonrpc: "2.0",
    method: "page.event",
    params: {
      subscriptionId,
      event: "response",
      pageId: "page-1",
      sessionId: "session-1",
      targetId: "target-1",
      response: {
        responseId: "response-1",
        url: "https://example.test/api",
        status: 200,
        statusText: "OK",
        headers: {},
        fromServiceWorker: false,
      },
    },
  };
}

describe("shared Page event subscriptions", () => {
  it("accepts every PageEventName through page.on, including a union-typed event", async () => {
    expectTypeOf<Page["on"]>().toBeCallableWith("pageerror", (_event: PageCDPEvent) => {});
    expectTypeOf<Page["on"]>().toBeCallableWith("console", (_event: PageCDPEvent) => {});
    const client = new FakeEventClient();
    const page = new Page(client, { pageId: "page-1" });
    const event: PageEventName = "pageerror";
    const subscription = await page.on(event, () => {});
    expect(client.subscriptionIds().map((call) => call.event)).toEqual(["pageerror"]);
    await subscription.unsubscribe();
  });

  it("keeps console, deprecated console, pageerror and response subscriptions independent", async () => {
    const client = new FakeEventClient();
    const page = new Page(client, { pageId: "page-1" });
    const consoleEvents: PageCDPEvent[] = [];
    const legacyConsoleEvents: PageCDPEvent[] = [];
    const pageErrors: PageCDPEvent[] = [];
    const responses: Response[] = [];

    const subscriptions: CDPSubscription[] = [
      await page.onConsole((event) => consoleEvents.push(event)),
      await page.on("console", (event) => legacyConsoleEvents.push(event)),
      await page.on("pageerror", (event) => pageErrors.push(event)),
      await page.onResponse((response) => responses.push(response)),
    ];
    const ons = client.subscriptionIds();
    expect(ons.map((call) => call.event)).toEqual(["console", "console", "pageerror", "response"]);
    expect(new Set(ons.map((call) => call.subscriptionId)).size).toBe(4);
    const [modernId, legacyId, pageErrorId, responseId] = ons.map((call) => call.subscriptionId);

    const log = cdpEvent("Runtime.consoleAPICalled", "log");
    const exception = cdpEvent("Runtime.exceptionThrown", "boom");
    client.emit(cdpNotification(modernId!, log));
    client.emit(cdpNotification(legacyId!, log));
    client.emit(cdpNotification(pageErrorId!, exception));
    client.emit(responseNotification(responseId!));
    // Notifications of the other channel never reach a listener, even with its subscription ID.
    client.emit(responseNotification(pageErrorId!));
    client.emit(cdpNotification(responseId!, exception));

    expect(consoleEvents).toStrictEqual([log]);
    expect(legacyConsoleEvents).toStrictEqual([log]);
    expect(pageErrors).toStrictEqual([exception]);
    expect(responses).toHaveLength(1);
    expect(responses[0]).toBeInstanceOf(Response);

    await subscriptions[2]!.unsubscribe();
    expect(client.calls.at(-1)).toStrictEqual({
      method: StagehandMethods.pageOff.name,
      params: { subscriptionId: pageErrorId },
    });
    client.emit(cdpNotification(pageErrorId!, exception));
    client.emit(cdpNotification(modernId!, log));
    client.emit(responseNotification(responseId!));
    expect(pageErrors).toHaveLength(1);
    expect(consoleEvents).toHaveLength(2);
    expect(responses).toHaveLength(2);

    for (const subscription of subscriptions) await subscription.unsubscribe();
    expect(client.listeners.size).toBe(0);
  });

  it.each(["response", "toolsadded", "toolsremoved", "unknown"])(
    "rejects %j through page.on before subscribing",
    async (event) => {
      const client = new FakeEventClient();
      const page = new Page(client, { pageId: "page-1" });
      await expect(page.on(event as PageEventName, () => {})).rejects.toThrow(
        'page.on only supports "console" and "pageerror" events',
      );
      expect(client.calls).toHaveLength(0);
      expect(client.listeners.size).toBe(0);
    },
  );
});
