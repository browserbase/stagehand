import { describe, expect, it, vi } from "vitest";
import { ClientLifecycle, CLIENT_TARGET_URL } from "../clientLifecycle.js";
import type { CdpConnection } from "../understudy/cdp.js";

function fixture() {
  const targets = new Set(["client-a", "client-b"]);
  const handlers = new Set<(event: { targetId: string }) => void>();
  let targetUrl = CLIENT_TARGET_URL;
  const createConnection = () => ({
    connected: true,
    getTargets: vi.fn(async () => [...targets].map((targetId) => ({ targetId, url: targetUrl }))),
    send: vi.fn(async (_method: string) => ({})),
    on: (_event: string, handler: (event: { targetId: string }) => void) => handlers.add(handler),
    off: (_event: string, handler: (event: { targetId: string }) => void) =>
      handlers.delete(handler),
  });
  // Each attachment opens its own B, so a reconnect must not reuse a closed one.
  const connections: ReturnType<typeof createConnection>[] = [];
  const options = {
    connection: vi.fn(async () => {
      const connection = createConnection();
      connections.push(connection);
      return connection as unknown as CdpConnection;
    }),
    rejectClientCallbacks: vi.fn(),
    closeConnection: vi.fn(async () => {}),
    disposeClient: vi.fn(async () => {}),
    onError: vi.fn(),
  };
  const lifecycle = new ClientLifecycle(options);
  const attach = (targetId = "client-a", terminate = false) =>
    lifecycle.handle({
      action: "attach",
      targetId,
      cdpUrl: "ws://browser",
      closeBrowserOnDisconnect: terminate,
    });
  const destroy = (targetId: string) => {
    targets.delete(targetId);
    for (const handler of handlers) handler({ targetId });
  };
  return {
    lifecycle,
    options,
    connections,
    get connection() {
      return connections.at(-1)!;
    },
    targets,
    setTargetUrl: (url: string) => {
      targetUrl = url;
    },
    attach,
    destroy,
  };
}

describe("client connection ownership", () => {
  const detach = (f: ReturnType<typeof fixture>, targetId = "client-a") =>
    f.lifecycle.handle({ action: "detach", targetId });

  it("terminates owned Chrome promptly without draining abandoned work", async () => {
    const f = fixture();
    f.options.disposeClient.mockImplementation(() => new Promise(() => {}));
    await f.attach("client-a", true);
    f.destroy("client-a");
    await vi.waitFor(() => expect(f.connection.send).toHaveBeenCalledWith("Browser.close"));
    expect(f.options.disposeClient).not.toHaveBeenCalled();
  });

  it("releases the client session, closes B, and permits fresh attachment", async () => {
    const f = fixture();
    await f.attach();
    f.destroy("client-a");
    await f.attach("client-b");
    expect(f.options.rejectClientCallbacks).toHaveBeenCalledOnce();
    expect(f.options.closeConnection).toHaveBeenCalledOnce();
    expect(f.options.disposeClient).toHaveBeenCalledOnce();
    expect(f.connections).toHaveLength(2);
    expect(f.connections[1]).not.toBe(f.connections[0]);
    expect(f.connections[1]?.getTargets).toHaveBeenCalled();
    for (const connection of f.connections) expect(connection.send).not.toHaveBeenCalled();
  });

  it("rejects client callbacks before closing B, and never waits for disposal", async () => {
    // e.g. the client died while stagehand.close() waited on an LLM call it was serving.
    const f = fixture();
    const order: string[] = [];
    f.options.rejectClientCallbacks.mockImplementation(() => order.push("reject"));
    f.options.closeConnection.mockImplementation(async () => {
      order.push("close B");
    });
    f.options.disposeClient.mockImplementation(() => new Promise(() => {}));
    await f.attach();
    f.destroy("client-a");
    await vi.waitFor(() => expect(order).toEqual(["reject", "close B"]));

    // A hung disposal does not block the next client from attaching.
    await f.attach("client-b");
    expect(f.connections).toHaveLength(2);
  });

  it("still closes B when disposing a lost client fails", async () => {
    const f = fixture();
    f.options.disposeClient.mockRejectedValue(new Error("disposal failed"));
    await f.attach();
    f.destroy("client-a");
    await vi.waitFor(() => expect(f.options.closeConnection).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(f.options.onError).toHaveBeenCalledOnce());
  });

  it("keeps a failed detach disarmed and retryable", async () => {
    const f = fixture();
    await f.attach("client-a", true);
    f.options.disposeClient.mockRejectedValueOnce(new Error("disposal failed"));
    await expect(detach(f)).rejects.toThrow("disposal failed");

    await detach(f);
    f.destroy("client-a");

    expect(f.options.disposeClient).toHaveBeenCalledTimes(2);
    expect(f.connection.send).not.toHaveBeenCalled();
  });

  it("never shuts the browser down when the client dies after a failed detach", async () => {
    const f = fixture();
    await f.attach("client-a", true);
    f.options.disposeClient.mockRejectedValueOnce(new Error("disposal failed"));
    await expect(detach(f)).rejects.toThrow("disposal failed");

    f.destroy("client-a");

    await vi.waitFor(() => expect(f.options.closeConnection).toHaveBeenCalledTimes(2));
    expect(f.connection.send).not.toHaveBeenCalled();
  });

  it("acknowledges a retried detach that already completed after the SDK timed out", async () => {
    const f = fixture();
    await f.attach("client-a", true);
    await detach(f);
    f.destroy("client-a");

    await detach(f);

    expect(f.options.disposeClient).toHaveBeenCalledOnce();
    expect(f.connection.send).not.toHaveBeenCalled();
  });

  it("acknowledges a late retry without touching a newer attachment", async () => {
    const f = fixture();
    await f.attach("client-a");
    await detach(f);
    f.destroy("client-a");
    await f.attach("client-b", true);

    await detach(f, "client-a");
    await expect(detach(f, "client-c")).rejects.toThrow("no longer active");

    expect(f.options.disposeClient).toHaveBeenCalledOnce();
    await expect(f.attach("client-c")).rejects.toThrow("already connected");
  });

  it("disarms owned-browser termination before intentional detach", async () => {
    const f = fixture();
    await f.attach("client-a", true);
    f.options.disposeClient.mockImplementation(async () => {
      f.destroy("client-a");
    });
    await detach(f);
    expect(f.options.rejectClientCallbacks).toHaveBeenCalledOnce();
    expect(f.options.closeConnection).toHaveBeenCalledOnce();
    expect(f.connection.send).not.toHaveBeenCalled();
  });

  it("ignores unrelated targets and rejects a second owner or stale detach", async () => {
    const f = fixture();
    await f.attach("client-a", true);
    f.destroy("unrelated");
    await expect(f.attach("client-b")).rejects.toThrow("already connected");
    await expect(detach(f, "client-b")).rejects.toThrow("no longer active");
    expect(f.options.disposeClient).not.toHaveBeenCalled();
    expect(f.connection.send).not.toHaveBeenCalled();
  });

  it("handles client death during observer startup, before targetDestroyed subscription", async () => {
    const f = fixture();
    f.targets.delete("client-a");
    await expect(f.attach("client-a", true)).rejects.toThrow("disconnected during registration");
    expect(f.connection.send).toHaveBeenCalledWith("Browser.close");
  });

  it("does not arm ownership using an ordinary page", async () => {
    const f = fixture();
    f.setTargetUrl("about:blank");
    await expect(f.attach("client-a", true)).rejects.toThrow("Invalid Stagehand");
    f.destroy("client-a");
    expect(f.connection.send).not.toHaveBeenCalled();
  });
});
