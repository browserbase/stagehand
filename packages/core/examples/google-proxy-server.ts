#!/usr/bin/env node

/**
 * Simple proxy server for testing Google API baseURL support
 * 
 * Usage:
 *   pnpm tsx examples/google-proxy-server.ts
 * 
 * Loads environment variables from .env file automatically
 */

import dotenv from "dotenv";
dotenv.config();

import http from "http";
import https from "https";
import { URL } from "url";

const PORT = parseInt(process.env.PORT || "8080", 10);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
const TARGET_BASE_URL = "https://generativelanguage.googleapis.com";

if (!GEMINI_API_KEY) {
  console.error(
    "Error: GEMINI_API_KEY or GOOGLE_API_KEY environment variable is required",
  );
  process.exit(1);
}

interface RequestMetrics {
  method: string;
  path: string;
  timestamp: Date;
  statusCode?: number;
  responseTime?: number;
  requestSize?: number;
  responseSize?: number;
}

const metrics: RequestMetrics[] = [];

function logRequest(metrics: RequestMetrics): void {
  console.log(
    `[${metrics.timestamp.toISOString()}] ${metrics.method} ${metrics.path} - ${
      metrics.statusCode || "pending"
    } (${metrics.responseTime || 0}ms)`,
  );
  if (metrics.requestSize) {
    console.log(`  Request size: ${metrics.requestSize} bytes`);
  }
  if (metrics.responseSize) {
    console.log(`  Response size: ${metrics.responseSize} bytes`);
  }
}

function proxyRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): void {
  const startTime = Date.now();
  const metric: RequestMetrics = {
    method: req.method || "UNKNOWN",
    path: req.url || "/",
    timestamp: new Date(),
  };

  // Parse the incoming request URL
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  const targetPath = url.pathname + url.search;

  // Build target URL - forward the path to Google's API
  // The GoogleGenAI SDK will send requests like /v1beta/models/{model}:generateContent
  const targetUrl = new URL(targetPath, TARGET_BASE_URL);
  const isHttps = targetUrl.protocol === "https:";
  const client = isHttps ? https : http;

  // Add API key to query params if not already present
  // Google API accepts key either as query param or header
  if (!targetUrl.searchParams.has("key")) {
    targetUrl.searchParams.set("key", GEMINI_API_KEY);
  }

  // Prepare headers - forward most headers but override some
  const headers: Record<string, string | string[] | undefined> = {
    ...req.headers,
    host: targetUrl.hostname,
    // Remove headers that shouldn't be forwarded
    connection: "close",
  };

  // Add API key header if not present (Google API accepts x-goog-api-key header)
  if (!headers["x-goog-api-key"] && !targetUrl.searchParams.has("key")) {
    headers["x-goog-api-key"] = GEMINI_API_KEY;
  }

  // Add forwarding headers for logging
  if (req.socket.remoteAddress) {
    headers["x-forwarded-for"] = req.socket.remoteAddress;
  }
  headers["x-forwarded-proto"] = "http";

  const options: https.RequestOptions = {
    hostname: targetUrl.hostname,
    port: targetUrl.port || (isHttps ? 443 : 80),
    path: targetUrl.pathname + targetUrl.search,
    method: req.method,
    headers,
  };

  // Remove undefined headers
  Object.keys(options.headers || {}).forEach((key) => {
    if (options.headers![key] === undefined) {
      delete options.headers![key];
    }
  });

  const sanitizedUrl = targetUrl.toString().replace(
    new RegExp(GEMINI_API_KEY, "g"),
    "***",
  );
  console.log(`Proxying ${req.method} ${req.url} -> ${sanitizedUrl}`);

  const proxyReq = client.request(options, (proxyRes) => {
    metric.statusCode = proxyRes.statusCode;
    metric.responseTime = Date.now() - startTime;

    // Set response headers
    res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);

    let responseSize = 0;
    proxyRes.on("data", (chunk: Buffer) => {
      responseSize += chunk.length;
      res.write(chunk);
    });

    proxyRes.on("end", () => {
      metric.responseSize = responseSize;
      res.end();
      logRequest(metric);
      metrics.push(metric);
    });
  });

  proxyReq.on("error", (error) => {
    console.error(`Proxy request error: ${error.message}`);
    metric.statusCode = 500;
    metric.responseTime = Date.now() - startTime;
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end(`Proxy error: ${error.message}`);
    logRequest(metric);
    metrics.push(metric);
  });

  // Forward request body
  let requestSize = 0;
  req.on("data", (chunk: Buffer) => {
    requestSize += chunk.length;
    proxyReq.write(chunk);
  });

  req.on("end", () => {
    metric.requestSize = requestSize;
    proxyReq.end();
  });

  req.on("error", (error) => {
    console.error(`Request error: ${error.message}`);
    proxyReq.destroy();
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end(`Request error: ${error.message}`);
    }
  });
}

const server = http.createServer(proxyRequest);

server.listen(PORT, () => {
  console.log(`🚀 Google API Proxy Server running on http://localhost:${PORT}`);
  console.log(`📊 Proxying requests to: ${TARGET_BASE_URL}`);
  console.log(`🔑 Using API key: ${GEMINI_API_KEY.substring(0, 10)}...`);
  console.log(`\n📈 Metrics will be logged for each request\n`);
  console.log(`Press Ctrl+C to stop the server\n`);
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n\n📊 Request Summary:");
  console.log(`Total requests: ${metrics.length}`);
  if (metrics.length > 0) {
    const avgResponseTime =
      metrics.reduce((sum, m) => sum + (m.responseTime || 0), 0) /
      metrics.length;
    const totalRequestSize = metrics.reduce(
      (sum, m) => sum + (m.requestSize || 0),
      0,
    );
    const totalResponseSize = metrics.reduce(
      (sum, m) => sum + (m.responseSize || 0),
      0,
    );
    console.log(`Average response time: ${avgResponseTime.toFixed(2)}ms`);
    console.log(`Total request size: ${totalRequestSize} bytes`);
    console.log(`Total response size: ${totalResponseSize} bytes`);
  }
  console.log("\n👋 Shutting down proxy server...");
  server.close(() => {
    process.exit(0);
  });
});

