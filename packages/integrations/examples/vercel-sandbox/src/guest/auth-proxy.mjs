import { createHash, timingSafeEqual } from "node:crypto";
import http from "node:http";

const digestHex = process.env.BRIDGE_TOKEN_SHA256;
if (!digestHex || !/^[0-9a-f]{64}$/i.test(digestHex)) {
  throw new Error("BRIDGE_TOKEN_SHA256 is required");
}
const expectedDigest = Buffer.from(digestHex, "hex");
const bridgePort = configuredPort("BRIDGE_PORT", 8000, false);
const proxyPort = configuredPort("PROXY_PORT", 3000, true);
const passthroughHeaders = [
  "accept",
  "content-type",
  "content-length",
  "last-event-id",
  "mcp-session-id",
  "mcp-protocol-version",
];

function authorized(value) {
  if (typeof value !== "string") return false;
  const match = /^Bearer\s+(.+)$/i.exec(value);
  if (!match) return false;
  const providedDigest = createHash("sha256").update(match[1]).digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}

const server = http.createServer((request, response) => {
  if (!authorized(request.headers.authorization)) {
    response.writeHead(401, { "content-type": "text/plain" });
    response.end("Unauthorized\n");
    return;
  }

  // Vercel's public edge buffers an otherwise idle SSE response. Stagehand
  // sends no server-initiated notifications, so reject the optional GET
  // stream and keep MCP request/response traffic on POST and DELETE.
  const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  if (pathname === "/mcp" && request.method !== "POST" && request.method !== "DELETE") {
    response.writeHead(405, {
      allow: "POST, DELETE",
      "content-type": "text/plain",
    });
    response.end("Method Not Allowed\n");
    return;
  }
  if (pathname !== "/mcp" && !(pathname === "/healthz" && request.method === "GET")) {
    response.writeHead(404, { "content-type": "text/plain" });
    response.end("Not Found\n");
    return;
  }

  const headers = { host: `127.0.0.1:${bridgePort}` };
  for (const name of passthroughHeaders) {
    const value = request.headers[name];
    if (value !== undefined) headers[name] = value;
  }

  const upstream = http.request(
    {
      host: "127.0.0.1",
      port: bridgePort,
      method: request.method,
      path: request.url,
      headers,
    },
    (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    },
  );
  upstream.on("error", () => {
    if (!response.headersSent) response.writeHead(502);
    response.end("Upstream unavailable\n");
  });
  request.once("aborted", () => upstream.destroy());
  response.once("close", () => {
    if (!response.writableEnded) upstream.destroy();
  });
  request.pipe(upstream);
});

server.listen(proxyPort, "0.0.0.0", () => {
  const address = server.address();
  if (process.send && typeof address === "object" && address !== null) {
    process.send({ port: address.port });
  }
});

function configuredPort(name, fallback, allowEphemeral) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be a valid port`);
  const port = Number(value);
  if (port > 65_535 || (!allowEphemeral && port === 0)) {
    throw new Error(`${name} must be a valid port`);
  }
  return port;
}
