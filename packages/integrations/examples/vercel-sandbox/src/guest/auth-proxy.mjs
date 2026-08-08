import { createHash, timingSafeEqual } from "node:crypto";
import http from "node:http";

const digestHex = process.env.BRIDGE_TOKEN_SHA256;
if (!digestHex || !/^[0-9a-f]{64}$/i.test(digestHex)) {
  throw new Error("BRIDGE_TOKEN_SHA256 is required");
}
const expectedDigest = Buffer.from(digestHex, "hex");
const passthroughHeaders = [
  "accept",
  "content-type",
  "content-length",
  "last-event-id",
  "mcp-session-id",
  "mcp-protocol-version",
];

function authorized(value) {
  if (typeof value !== "string" || !value.startsWith("Bearer ")) return false;
  const providedDigest = createHash("sha256").update(value.slice("Bearer ".length)).digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}

http
  .createServer((request, response) => {
    if (!authorized(request.headers.authorization)) {
      response.writeHead(401, { "content-type": "text/plain" });
      response.end("Unauthorized\n");
      return;
    }

    // Vercel's public edge buffers an otherwise idle SSE response. Stagehand
    // sends no server-initiated notifications, so reject the optional GET
    // stream and keep MCP request/response traffic on POST and DELETE.
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    if (request.method === "GET" && pathname === "/mcp") {
      response.writeHead(405, {
        allow: "POST, DELETE",
        "content-type": "text/plain",
      });
      response.end("Method Not Allowed\n");
      return;
    }

    const headers = { host: "127.0.0.1:8000" };
    for (const name of passthroughHeaders) {
      const value = request.headers[name];
      if (value !== undefined) headers[name] = value;
    }

    const upstream = http.request(
      {
        host: "127.0.0.1",
        port: 8000,
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
    request.pipe(upstream);
  })
  .listen(3000, "0.0.0.0");
