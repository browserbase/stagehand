import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { Duplex } from "node:stream";

const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export class FakePid2Server {
  private readonly server: Server;
  private readonly sockets = new Set<Duplex>();
  private readonly upstreamSockets = new Set<WebSocket>();
  readonly pausedSessions = new Set<string>();
  readonly autoAttachRequests: unknown[] = [];
  readonly clientMethods: string[] = [];
  connectionCount = 0;
  upstreamConnectionCount = 0;
  clientMessageCount = 0;
  lastProxyError = "";

  constructor(
    private readonly resolveUpstreamUrl: () => Promise<string>,
    private readonly activationEpoch = "fake-pid2-reservation",
  ) {
    this.server = createServer();
    this.server.on("upgrade", (request, socket) => {
      if (request.url !== "/stagehand/v1") {
        socket.end("HTTP/1.1 404 Not Found\r\n\r\n");
        return;
      }
      const key = request.headers["sec-websocket-key"];
      if (typeof key !== "string") {
        socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
        return;
      }
      socket.write(
        [
          "HTTP/1.1 101 Switching Protocols",
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Accept: ${createHash("sha1")
            .update(key + WEBSOCKET_GUID)
            .digest("base64")}`,
          "\r\n",
        ].join("\r\n"),
      );
      this.sockets.add(socket);
      this.connectionCount += 1;
      socket.once("close", () => this.sockets.delete(socket));
      void this.proxy(socket);
    });
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(8083, "127.0.0.1", () => {
        this.server.off("error", reject);
        resolve();
      });
    });
  }

  async close(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    for (const upstream of this.upstreamSockets) upstream.close();
    if (!this.server.listening) return;
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  private async proxy(socket: Duplex): Promise<void> {
    socket.write(
      encodeFrame(
        JSON.stringify({
          type: "stagehand.activation",
          protocolVersion: "1",
          state: "active",
          activationEpoch: this.activationEpoch,
        }),
      ),
    );

    const queuedForUpstream: string[] = [];
    let upstream: WebSocket | undefined;
    let input: Buffer = Buffer.alloc(0);
    let fragmented: Buffer[] = [];
    let fragmentedOpcode = 0;

    socket.on("data", (chunk: Buffer) => {
      input = Buffer.concat([input, chunk]);
      while (true) {
        const decoded = decodeFrame(input);
        if (!decoded) break;
        input = decoded.rest;
        const { frame } = decoded;
        if (frame.opcode === 0x8) {
          upstream?.close();
          socket.end(encodeFrame(frame.payload, 0x8));
          return;
        }
        if (frame.opcode === 0x9) {
          socket.write(encodeFrame(frame.payload, 0xa));
          continue;
        }
        if (frame.opcode === 0x1 || frame.opcode === 0x2) {
          fragmentedOpcode = frame.opcode;
          fragmented = [frame.payload];
        } else if (frame.opcode === 0x0 && fragmentedOpcode !== 0) {
          fragmented.push(frame.payload);
        } else {
          continue;
        }
        if (!frame.final) continue;
        const message = Buffer.concat(fragmented).toString("utf8");
        fragmented = [];
        fragmentedOpcode = 0;
        this.observeClientCdp(message);
        this.clientMessageCount += 1;
        if (upstream?.readyState === WebSocket.OPEN) upstream.send(message);
        else queuedForUpstream.push(message);
      }
    });

    try {
      upstream = new WebSocket(await this.resolveUpstreamUrl());
      this.upstreamSockets.add(upstream);
      upstream.binaryType = "arraybuffer";
      await waitForOpen(upstream);
      this.upstreamConnectionCount += 1;
      for (const message of queuedForUpstream.splice(0)) upstream.send(message);
      upstream.addEventListener("message", (event) => {
        const payload = messageBytes(event.data);
        const text = payload.toString("utf8");
        this.observeBrowserCdp(text);
        if (!socket.destroyed) socket.write(encodeFrame(payload, 0x1));
      });
      upstream.addEventListener("close", () => {
        this.upstreamSockets.delete(upstream!);
        if (!socket.destroyed) socket.end(encodeFrame(Buffer.alloc(0), 0x8));
      });
      upstream.addEventListener("error", () => socket.destroy());
    } catch (error) {
      this.lastProxyError = error instanceof Error ? error.message : String(error);
      socket.destroy();
    }
  }

  private observeClientCdp(raw: string): void {
    try {
      const message = JSON.parse(raw) as {
        method?: string;
        params?: unknown;
        sessionId?: string;
      };
      if (message.method === "Target.setAutoAttach") {
        this.autoAttachRequests.push(message.params);
      }
      if (message.method) this.clientMethods.push(message.method);
      if (message.method === "Runtime.runIfWaitingForDebugger" && message.sessionId) {
        this.pausedSessions.delete(message.sessionId);
      }
      if (message.method === "Target.detachFromTarget") {
        const params = message.params as { sessionId?: string } | undefined;
        if (params?.sessionId) this.pausedSessions.delete(params.sessionId);
      }
    } catch {
      // The real CDP parser owns validation; this server only tracks pause state.
    }
  }

  private observeBrowserCdp(raw: string): void {
    try {
      const message = JSON.parse(raw) as {
        method?: string;
        params?: { sessionId?: string };
      };
      if (message.method === "Target.attachedToTarget" && message.params?.sessionId) {
        this.pausedSessions.add(message.params.sessionId);
      }
      if (message.method === "Target.detachedFromTarget" && message.params?.sessionId) {
        this.pausedSessions.delete(message.params.sessionId);
      }
    } catch {
      // The real CDP parser owns validation; this server only tracks pause state.
    }
  }
}

async function waitForOpen(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.OPEN) return;
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error("Chrome CDP socket failed")), {
      once: true,
    });
  });
}

function messageBytes(data: unknown): Buffer {
  if (typeof data === "string") return Buffer.from(data);
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  }
  throw new TypeError("Unsupported upstream WebSocket message type");
}

function encodeFrame(payload: string | Buffer, opcode = 0x1): Buffer {
  const body = typeof payload === "string" ? Buffer.from(payload) : payload;
  let header: Buffer;
  if (body.length < 126) {
    header = Buffer.from([0x80 | opcode, body.length]);
  } else if (body.length <= 0xffff) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(body.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(body.length), 2);
  }
  return Buffer.concat([header, body]);
}

function decodeFrame(buffer: Buffer):
  | {
      frame: { final: boolean; opcode: number; payload: Buffer };
      rest: Buffer;
    }
  | undefined {
  if (buffer.length < 2) return undefined;
  const first = buffer[0]!;
  const second = buffer[1]!;
  const final = (first & 0x80) !== 0;
  const opcode = first & 0x0f;
  const masked = (second & 0x80) !== 0;
  let length = second & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < 4) return undefined;
    length = buffer.readUInt16BE(2);
    offset = 4;
  } else if (length === 127) {
    if (buffer.length < 10) return undefined;
    const wideLength = buffer.readBigUInt64BE(2);
    if (wideLength > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("WebSocket frame too large");
    length = Number(wideLength);
    offset = 10;
  }
  const maskOffset = offset;
  if (masked) offset += 4;
  if (buffer.length < offset + length) return undefined;
  const payload = Buffer.from(buffer.subarray(offset, offset + length));
  if (masked) {
    for (let index = 0; index < payload.length; index += 1) {
      payload[index] ^= buffer[maskOffset + (index % 4)]!;
    }
  }
  return {
    frame: { final, opcode, payload },
    rest: buffer.subarray(offset + length),
  };
}
