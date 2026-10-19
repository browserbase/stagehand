import { afterEach, describe, expect, it, vi } from "vitest";
import {
  StagehandMethods,
  StagehandNotifications,
} from "@browserbasehq/stagehand-protocol/schema-registry";
import { ChromeRuntimeClient } from "../clients/chromeRuntimeClient.js";
import { RPCClient } from "../clients/rpcClient.js";
import { createStagehandRuntime } from "../runtime.js";
import { RPCRouter } from "../rpcRouter.js";

const clients: RPCClient[] = [];
afterEach(() => {
  for (const client of clients.splice(0)) client.close();
  vi.restoreAllMocks();
});

function setup(binding: (payload: string) => void = () => {}) {
  const transport = new ChromeRuntimeClient({ send: binding }, "send");
  const client = new RPCClient(transport, new RPCRouter(createStagehandRuntime()));
  clients.push(client);
  return { client, transport };
}

function cancellation(client: RPCClient, signal: AbortSignal) {
  return {
    signal,
    onAbort: (requestId: number) =>
      client.notify(StagehandNotifications.browserbaseCancel, { requestId, reason: "cancelled" }),
  };
}

describe("worker reverse RPC cancellation", () => {
  it("does not dispatch or register an already aborted request", async () => {
    const binding = vi.fn();
    const { client } = setup(binding);
    const controller = new AbortController();
    controller.abort();
    const add = vi.spyOn(controller.signal, "addEventListener");
    await expect(
      client.send(StagehandMethods.contextPages, {}, cancellation(client, controller.signal)),
    ).rejects.toBe(controller.signal.reason);
    expect(binding).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
    expect(client.pending.size).toBe(0);
  });

  it("sends cancellation after the request when aborted inside the binding", async () => {
    const controller = new AbortController();
    const messages: Record<string, unknown>[] = [];
    const { client } = setup((payload) => {
      const message = JSON.parse(payload) as Record<string, unknown>;
      messages.push(message);
      if (message.method === "context.pages") controller.abort();
    });
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    await expect(
      client.send(StagehandMethods.contextPages, {}, cancellation(client, controller.signal)),
    ).rejects.toBe(controller.signal.reason);
    expect(messages).toMatchObject([
      { id: 1, method: "context.pages" },
      { method: "browserbase.cancel", params: { request_id: 1, reason: "cancelled" } },
    ]);
    expect(remove).toHaveBeenCalledOnce();
    expect(client.pending.size).toBe(0);
  });

  it("settles abort immediately while dispatch is pending and notifies after dispatch", async () => {
    const messages: unknown[] = [];
    const { client, transport } = setup((payload) => messages.push(JSON.parse(payload)));
    let release!: () => void;
    const dispatch = new Promise<void>((resolve) => {
      release = resolve;
    });
    const send = transport.send.bind(transport);
    vi.spyOn(transport, "send").mockImplementationOnce(async (message) => {
      await dispatch;
      await send(message);
    });
    const controller = new AbortController();
    const request = client.send(
      StagehandMethods.contextPages,
      {},
      cancellation(client, controller.signal),
    );
    controller.abort();
    await expect(request).rejects.toBe(controller.signal.reason);
    expect(client.pending.size).toBe(0);
    expect(messages).toEqual([]);
    release();
    await vi.waitFor(() => expect(messages).toHaveLength(2));
    expect(messages).toMatchObject([{ id: 1 }, { params: { request_id: 1 } }]);
  });

  it("does not notify cancellation after failed dispatch", async () => {
    const { client, transport } = setup();
    let reject!: (error: Error) => void;
    vi.spyOn(transport, "send").mockImplementationOnce(
      () =>
        new Promise<void>((_, fail) => {
          reject = fail;
        }),
    );
    const controller = new AbortController();
    const onAbort = vi.fn();
    const request = client.send(
      StagehandMethods.contextPages,
      {},
      { signal: controller.signal, onAbort },
    );
    controller.abort();
    await expect(request).rejects.toBe(controller.signal.reason);
    reject(new Error("dispatch failed"));
    await Promise.resolve();
    expect(onAbort).not.toHaveBeenCalled();
    expect(client.pending.size).toBe(0);
  });

  it.each(["throw", "reject", "pending"])(
    "ignores %s from cancellation notification",
    async (mode) => {
      const { client } = setup();
      const controller = new AbortController();
      const onAbort = vi.fn(() => {
        if (mode === "throw") throw new Error("notification failed");
        if (mode === "reject") return Promise.reject(new Error("notification failed"));
        return new Promise<void>(() => {});
      });
      const request = client.send(
        StagehandMethods.contextPages,
        {},
        { signal: controller.signal, onAbort },
      );
      await Promise.resolve();
      controller.abort();
      await expect(request).rejects.toBe(controller.signal.reason);
      expect(onAbort).toHaveBeenCalledOnce();
      expect(client.pending.size).toBe(0);
    },
  );

  it("keeps a completed response when abort follows synchronously", async () => {
    const { client, transport } = setup();
    const controller = new AbortController();
    const onAbort = vi.fn();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const request = client.send(
      StagehandMethods.contextPages,
      {},
      { signal: controller.signal, onAbort },
    );
    await transport.receive(JSON.stringify({ jsonrpc: "2.0", id: 1, result: [] }));
    controller.abort();
    await expect(request).resolves.toEqual([]);
    expect(onAbort).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledOnce();
  });

  it("ignores late responses without affecting another pending request", async () => {
    const { client, transport } = setup();
    const controller = new AbortController();
    const first = client.send(StagehandMethods.contextPages, {}, { signal: controller.signal });
    const second = client.send(StagehandMethods.contextPages, {});
    controller.abort();
    await expect(first).rejects.toBe(controller.signal.reason);
    await transport.receive(JSON.stringify({ jsonrpc: "2.0", id: 1, result: [] }));
    expect([...client.pending.keys()]).toEqual([2]);
    await transport.receive(JSON.stringify({ jsonrpc: "2.0", id: 2, result: [] }));
    await expect(second).resolves.toEqual([]);
    expect(client.pending.size).toBe(0);
  });

  it.each(["dispatch", "disconnect", "invalid result", "RPC error"])(
    "cleans up after %s",
    async (failure) => {
      const { client, transport } = setup();
      const controller = new AbortController();
      const remove = vi.spyOn(controller.signal, "removeEventListener");
      const onAbort = vi.fn();
      if (failure === "dispatch")
        vi.spyOn(transport, "send").mockRejectedValueOnce(new Error("dispatch failed"));
      const request = client.send(
        StagehandMethods.contextPages,
        {},
        { signal: controller.signal, onAbort },
      );
      const rejected = expect(request).rejects.toBeInstanceOf(Error);
      if (failure === "disconnect") client.close(new Error("connection lost"));
      if (failure === "invalid result")
        await transport.receive(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }));
      if (failure === "RPC error")
        await transport.receive(
          JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32603, message: "failed" } }),
        );
      await rejected;
      controller.abort();
      expect(remove).toHaveBeenCalledOnce();
      expect(onAbort).not.toHaveBeenCalled();
      expect(client.pending.size).toBe(0);
    },
  );
});
