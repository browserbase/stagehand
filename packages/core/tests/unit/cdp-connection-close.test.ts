import { describe, it, expect, afterEach } from "vitest";
import { WebSocketServer, type WebSocket as ServerWebSocket } from "ws";
import { CdpConnection } from "../../lib/v3/understudy/cdp.js";

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

describe("CdpConnection", () => {
  let wss: WebSocketServer | null = null;

  afterEach(async () => {
    if (wss) {
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
});
