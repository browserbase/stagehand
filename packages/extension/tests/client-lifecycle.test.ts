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
    releaseClient: vi.fn(async () => {}),
    closeConnection: vi.fn(async () => {}),
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
  it("terminates owned Chrome promptly without draining abandoned work", async () => {
    const f = fixture();
    f.options.releaseClient.mockImplementation(() => new Promise(() => {}));
    await f.attach("client-a", true);
    f.destroy("client-a");
    await vi.waitFor(() => expect(f.connection.send).toHaveBeenCalledWith("Browser.close"));
    expect(f.options.releaseClient).not.toHaveBeenCalled();
  });

  it("releases the client session, closes B, and permits fresh attachment", async () => {
    const f = fixture();
    await f.attach();
    f.destroy("client-a");
    await f.attach("client-b");
    expect(f.options.releaseClient).toHaveBeenCalledOnce();
    expect(f.options.closeConnection).toHaveBeenCalledOnce();
    expect(f.connections).toHaveLength(2);
    expect(f.connections[1]).not.toBe(f.connections[0]);
    expect(f.connections[1]?.getTargets).toHaveBeenCalled();
    for (const connection of f.connections) expect(connection.send).not.toHaveBeenCalled();
  });

  it("closes B on loss without waiting for in-flight work to drain", async () => {
    const f = fixture();
    f.options.releaseClient.mockImplementation(() => new Promise(() => {}));
    await f.attach();
    f.destroy("client-a");
    await vi.waitFor(() => expect(f.options.closeConnection).toHaveBeenCalledOnce());
    expect(f.connection.send).not.toHaveBeenCalled();
  });

  it("keeps a failed detach disarmed and retryable", async () => {
    const f = fixture();
    await f.attach("client-a", true);
    f.options.releaseClient.mockRejectedValueOnce(new Error("disposal failed"));
    await expect(f.lifecycle.handle({ action: "detach", targetId: "client-a" })).rejects.toThrow(
      "disposal failed",
    );

    await f.lifecycle.handle({ action: "detach", targetId: "client-a" });
    f.destroy("client-a");

    expect(f.options.closeConnection).toHaveBeenCalledOnce();
    expect(f.connection.send).not.toHaveBeenCalled();
  });

  it("never shuts the browser down when the client dies after a failed detach", async () => {
    const f = fixture();
    await f.attach("client-a", true);
    f.options.releaseClient.mockRejectedValueOnce(new Error("disposal failed"));
    await expect(f.lifecycle.handle({ action: "detach", targetId: "client-a" })).rejects.toThrow(
      "disposal failed",
    );

    f.destroy("client-a");

    await vi.waitFor(() => expect(f.options.closeConnection).toHaveBeenCalled());
    expect(f.connection.send).not.toHaveBeenCalled();
  });

  it("still closes B when releasing a lost client fails", async () => {
    const f = fixture();
    f.options.releaseClient.mockRejectedValue(new Error("disposal failed"));
    await f.attach();
    f.destroy("client-a");
    await vi.waitFor(() => expect(f.options.closeConnection).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(f.options.onError).toHaveBeenCalledOnce());
  });

  it("disarms owned-browser termination before intentional detach", async () => {
    const f = fixture();
    await f.attach("client-a", true);
    f.options.releaseClient.mockImplementation(async () => {
      f.destroy("client-a");
    });
    await f.lifecycle.handle({ action: "detach", targetId: "client-a" });
    expect(f.options.releaseClient).toHaveBeenCalledOnce();
    expect(f.options.closeConnection).toHaveBeenCalledOnce();
    expect(f.connection.send).not.toHaveBeenCalled();
  });

  it("ignores unrelated targets and rejects a second owner or stale detach", async () => {
    const f = fixture();
    await f.attach("client-a", true);
    f.destroy("unrelated");
    await expect(f.attach("client-b")).rejects.toThrow("already connected");
    await expect(f.lifecycle.handle({ action: "detach", targetId: "client-b" })).rejects.toThrow(
      "no longer active",
    );
    expect(f.options.releaseClient).not.toHaveBeenCalled();
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
