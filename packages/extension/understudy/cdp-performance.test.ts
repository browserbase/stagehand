import { describe, expect, it, vi } from "vitest";
import { CdpConnection, CdpSession } from "./cdp.js";
import type { CdpWebSocketTransport } from "./cdp.js";

function createConnection() {
  const sent: { id: number; method: string; sessionId?: string; params?: object }[] = [];
  const transport = {
    connected: true,
    send(payload: string) {
      sent.push(JSON.parse(payload));
    },
    async close() {},
    onMessage() {},
    onClose() {},
    onError() {},
  } satisfies CdpWebSocketTransport;
  const logger = { debug: vi.fn(), error: vi.fn(), isEnabled: () => false };
  const connection = new CdpConnection(transport, logger);
  const respond = (id: number, error?: { code: number; message: string }) =>
    connection.onMessage(JSON.stringify({ id, ...(error ? { error } : { result: {} }) }));
  return { connection, logger, sent, respond };
}

describe("CDP logging fast path", () => {
  it.each([false, true])(
    "serializes parameters only for the transport, session=%s",
    async (session) => {
      const { connection, logger, respond } = createConnection();
      const toJSON = vi.fn(() => ({ text: "hello" }));
      const sender = session ? new CdpSession(connection, "session-1") : connection;
      const response = sender.send("Input.insertText", { toJSON });
      respond(1);
      await response;
      connection.onMessage(
        JSON.stringify({ method: "Network.dataReceived", params: { dataLength: 1 } }),
      );
      expect(toJSON).toHaveBeenCalledTimes(1);
      expect(logger.debug).not.toHaveBeenCalled();
    },
  );

  it("still records command failures when debug is disabled", async () => {
    const { connection, logger, respond } = createConnection();
    const response = connection.send("Runtime.evaluate");
    respond(1, { code: -32000, message: "Context gone" });
    await expect(response).rejects.toThrow("Context gone");
    expect(logger.error).toHaveBeenCalledExactlyOnceWith("CDP response failed", {
      requestId: 1,
      method: "Runtime.evaluate",
      error: "-32000 Context gone",
      targetId: null,
    });
  });
});

describe("CDP session domain setup", () => {
  it.each(["Runtime", "DOM"] as const)(
    "reuses in-flight and completed %s setup",
    async (domain) => {
      const { connection, sent, respond } = createConnection();
      const session = new CdpSession(connection, "session-1");
      const initial = session.send(`${domain}.enable`);
      expect(session.ensureDomainEnabled(domain)).toBe(initial);
      expect(sent).toHaveLength(1);
      respond(1);
      await initial;
      await session.ensureDomainEnabled(domain);
      expect(sent).toHaveLength(1);

      const explicit = session.send(`${domain}.enable`);
      expect(sent).toHaveLength(2);
      respond(2);
      await explicit;
      const other = new CdpSession(connection, "session-2");
      const independent = other.ensureDomainEnabled(domain);
      expect(sent).toHaveLength(3);
      respond(3);
      await independent;
    },
  );

  it("retries failures and invalidates setup after disable", async () => {
    const { connection, sent, respond } = createConnection();
    const session = new CdpSession(connection, "session-1");
    const failed = session.ensureDomainEnabled("DOM");
    respond(1, { code: -32000, message: "Temporary failure" });
    await expect(failed).rejects.toThrow("Temporary failure");
    const retried = session.ensureDomainEnabled("DOM");
    respond(2);
    await retried;
    const disabled = session.send("DOM.disable");
    respond(3);
    await disabled;
    const enabled = session.ensureDomainEnabled("DOM");
    respond(4);
    await enabled;
    expect(sent.map(({ method }) => method)).toEqual([
      "DOM.enable",
      "DOM.enable",
      "DOM.disable",
      "DOM.enable",
    ]);
  });

  it("does not cache domain enables with options", async () => {
    const { connection, sent, respond } = createConnection();
    const session = new CdpSession(connection, "session-1");
    const configured = session.send("DOM.enable", { includeDeprecated: true });
    respond(1);
    await configured;
    const standard = session.ensureDomainEnabled("DOM");
    respond(2);
    await standard;
    expect(sent).toHaveLength(2);
  });
});
