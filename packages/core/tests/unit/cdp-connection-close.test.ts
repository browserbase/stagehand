import { describe, it, expect, afterEach, vi } from "vitest";
import { WebSocketServer, type WebSocket as ServerWebSocket } from "ws";
import { CdpConnection } from "../../lib/v3/understudy/cdp.js";

type ConnectionInternals = {
  eventHandlers: Map<string, Set<unknown>>;
};

/**
 * Races a promise against a timeout. Returns "resolved" if the promise
 * settles before the deadline, or "timeout" if it doesn't.
 */
// TODO: dedupe this with the implementation in testUtils.ts after we unify the test directories
function raceTimeout<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T | "timeout"> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Creates a local WebSocket server and connects a CdpConnection to it.
 * Returns the connection plus a handle to the server-side socket.
 */
async function createPair(): Promise<{
  conn: CdpConnection;
  serverSocket: ServerWebSocket;
  wss: WebSocketServer;
}> {
  const wss = new WebSocketServer({ port: 0 });
  const port = (wss.address() as { port: number }).port;

  const serverSocketPromise = new Promise<ServerWebSocket>((resolve) => {
    wss.once("connection", resolve);
  });

  const conn = await CdpConnection.connect(`ws://localhost:${port}`);
  const serverSocket = await serverSocketPromise;

  return { conn, serverSocket, wss };
}

async function sendCdpEvent(
  serverSocket: ServerWebSocket,
  message: Record<string, unknown>,
): Promise<void> {
  serverSocket.send(JSON.stringify(message));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("CdpConnection", () => {
  let wss: WebSocketServer | null = null;

  afterEach(async () => {
    if (wss) {
      for (const client of wss.clients) {
        client.terminate();
      }
      await new Promise<void>((resolve) => wss!.close(() => resolve()));
      wss = null;
    }
  });

  describe("close() when WebSocket is already closed", () => {
    it("resolves instead of hanging forever", async () => {
      const pair = await createPair();
      wss = pair.wss;

      // Wait for the client-side close event to be fully processed.
      const transportClosed = new Promise<void>((resolve) => {
        pair.conn.onTransportClosed(() => resolve());
      });

      // Simulate the hosted API terminating the Browserbase session:
      // the server closes the WebSocket from its side.
      pair.serverSocket.close();
      await transportClosed;

      // conn.close() on an already-CLOSED WebSocket must resolve.
      // Without the fix it awaits a "close" event that already fired → hangs.
      const result = await raceTimeout(
        pair.conn.close().then(() => "resolved"),
        3_000,
      );

      expect(result).toBe("resolved");
    });
  });

  describe("inflight CDP calls on unexpected close", () => {
    it("rejects pending calls instead of hanging forever", async () => {
      const pair = await createPair();
      wss = pair.wss;

      // Send a CDP command; the mock server will never reply.
      const pending = pair.conn.send("Runtime.evaluate", {
        expression: "1+1",
      });

      // Server terminates the connection while the call is inflight.
      pair.serverSocket.close();

      // The pending promise must reject, not hang.
      const result = await raceTimeout(
        pending.then(() => "resolved").catch(() => "rejected"),
        3_000,
      );

      expect(result).toBe("rejected");
    });
  });

  describe("session event listener cleanup", () => {
    it("removes session-scoped event handlers when a target detaches", async () => {
      const pair = await createPair();
      wss = pair.wss;

      await sendCdpEvent(pair.serverSocket, {
        method: "Target.attachedToTarget",
        params: {
          sessionId: "session-a",
          targetInfo: {
            targetId: "target-a",
            type: "page",
            title: "",
            url: "about:blank",
            attached: true,
            canAccessOpener: false,
          },
        },
      });

      const session = pair.conn.getSession("session-a");
      expect(session).toBeDefined();

      session!.on("Fetch.requestPaused", () => {});
      session!.on("Network.requestWillBeSent", () => {});

      await sendCdpEvent(pair.serverSocket, {
        method: "Target.attachedToTarget",
        params: {
          sessionId: "session-b",
          targetInfo: {
            targetId: "target-b",
            type: "iframe",
            title: "",
            url: "about:blank",
            attached: true,
            canAccessOpener: false,
          },
        },
      });

      const otherSession = pair.conn.getSession("session-b");
      expect(otherSession).toBeDefined();
      otherSession!.on("Fetch.requestPaused", () => {});

      const rootHandler = vi.fn();
      pair.conn.on("Target.targetCreated", rootHandler);

      const eventHandlers = (pair.conn as unknown as ConnectionInternals)
        .eventHandlers;
      expect(eventHandlers.has("session-a:Fetch.requestPaused")).toBe(true);
      expect(eventHandlers.has("session-a:Network.requestWillBeSent")).toBe(
        true,
      );
      expect(eventHandlers.has("session-b:Fetch.requestPaused")).toBe(true);

      await sendCdpEvent(pair.serverSocket, {
        method: "Target.detachedFromTarget",
        params: {
          sessionId: "session-a",
          targetId: "target-a",
        },
      });

      await sendCdpEvent(pair.serverSocket, {
        method: "Target.targetCreated",
        params: {
          targetInfo: {
            targetId: "target-b",
            type: "page",
            title: "",
            url: "about:blank",
            attached: false,
            canAccessOpener: false,
          },
        },
      });

      expect(eventHandlers.has("session-a:Fetch.requestPaused")).toBe(false);
      expect(eventHandlers.has("session-a:Network.requestWillBeSent")).toBe(
        false,
      );
      expect(eventHandlers.has("session-b:Fetch.requestPaused")).toBe(true);
      expect(eventHandlers.has("Target.targetCreated")).toBe(true);
      expect(rootHandler).toHaveBeenCalledOnce();
    });

    it("removes session-scoped event handlers when a target is destroyed", async () => {
      const pair = await createPair();
      wss = pair.wss;

      await sendCdpEvent(pair.serverSocket, {
        method: "Target.attachedToTarget",
        params: {
          sessionId: "session-a",
          targetInfo: {
            targetId: "target-a",
            type: "page",
            title: "",
            url: "about:blank",
            attached: true,
            canAccessOpener: false,
          },
        },
      });

      const session = pair.conn.getSession("session-a");
      expect(session).toBeDefined();
      session!.on("Fetch.requestPaused", () => {});

      const eventHandlers = (pair.conn as unknown as ConnectionInternals)
        .eventHandlers;
      expect(eventHandlers.has("session-a:Fetch.requestPaused")).toBe(true);

      await sendCdpEvent(pair.serverSocket, {
        method: "Target.targetDestroyed",
        params: {
          targetId: "target-a",
        },
      });

      expect(eventHandlers.has("session-a:Fetch.requestPaused")).toBe(false);
    });

    it("removes all session-scoped event handlers for a destroyed target", async () => {
      const pair = await createPair();
      wss = pair.wss;

      for (const sessionId of ["session-a", "session-b"]) {
        await sendCdpEvent(pair.serverSocket, {
          method: "Target.attachedToTarget",
          params: {
            sessionId,
            targetInfo: {
              targetId: "target-a",
              type: "page",
              title: "",
              url: "about:blank",
              attached: true,
              canAccessOpener: false,
            },
          },
        });
      }

      const sessionA = pair.conn.getSession("session-a");
      const sessionB = pair.conn.getSession("session-b");
      expect(sessionA).toBeDefined();
      expect(sessionB).toBeDefined();

      sessionA!.on("Fetch.requestPaused", () => {});
      sessionB!.on("Fetch.requestPaused", () => {});

      const eventHandlers = (pair.conn as unknown as ConnectionInternals)
        .eventHandlers;
      expect(eventHandlers.has("session-a:Fetch.requestPaused")).toBe(true);
      expect(eventHandlers.has("session-b:Fetch.requestPaused")).toBe(true);

      await sendCdpEvent(pair.serverSocket, {
        method: "Target.targetDestroyed",
        params: {
          targetId: "target-a",
        },
      });

      expect(eventHandlers.has("session-a:Fetch.requestPaused")).toBe(false);
      expect(eventHandlers.has("session-b:Fetch.requestPaused")).toBe(false);
    });
  });
});
