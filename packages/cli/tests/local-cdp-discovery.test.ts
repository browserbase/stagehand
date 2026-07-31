import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import {
  discoverLocalCdp,
  resolveWsTargetFromPort,
} from "../src/lib/driver/local-cdp-discovery.js";

/**
 * Starts a fake CDP HTTP server on an OS-assigned port. `wsPathForPort` gets
 * the bound port so it can bake the real port into the reported
 * webSocketDebuggerUrl, mirroring how a real browser reports itself.
 */
async function startFakeCdpServer(
  wsPathForPort: (port: number) => string,
): Promise<{
  port: number;
  wsUrl: string;
  requestCount: () => number;
  close: () => Promise<void>;
}> {
  let wsUrl = "";
  let requests = 0;
  const server: Server = createServer((req, res) => {
    if (req.url === "/json/version") {
      requests += 1;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ webSocketDebuggerUrl: wsUrl }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  wsUrl = wsPathForPort(port);

  return {
    port,
    wsUrl,
    requestCount: () => requests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

async function writeDevToolsActivePort(
  dir: string,
  port: number,
  wsPath: string,
): Promise<void> {
  await writeFile(
    join(dir, "DevToolsActivePort"),
    `${port}\n${wsPath}\n`,
    "utf8",
  );
}

describe("local CDP discovery", () => {
  const tempDirs: string[] = [];
  const servers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((close) => close()));
    await Promise.all(
      tempDirs
        .splice(0)
        .map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it("resolveWsTargetFromPort ignores a stale DevToolsActivePort file when the live browser reports a different target", async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), "browse-cdp-stale-"));
    tempDirs.push(userDataDir);

    const {
      port,
      wsUrl: liveWsUrl,
      close,
    } = await startFakeCdpServer(
      (p) => `ws://127.0.0.1:${p}/devtools/browser/live-id`,
    );
    servers.push(close);

    // Simulate a leftover file from a previous Chrome instance that used to
    // listen on this same port under a different browser id.
    await writeDevToolsActivePort(
      userDataDir,
      port,
      "/devtools/browser/stale-id",
    );

    const resolved = await resolveWsTargetFromPort(port, {
      userDataDirs: [userDataDir],
    });

    expect(resolved).toBe(liveWsUrl);
    expect(resolved).not.toContain("stale-id");
  });

  it("resolveWsTargetFromPort trusts a DevToolsActivePort file that matches the live browser", async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), "browse-cdp-fresh-"));
    tempDirs.push(userDataDir);

    const {
      port,
      wsUrl: liveWsUrl,
      close,
    } = await startFakeCdpServer(
      (p) => `ws://127.0.0.1:${p}/devtools/browser/current-id`,
    );
    servers.push(close);

    await writeDevToolsActivePort(
      userDataDir,
      port,
      "/devtools/browser/current-id",
    );

    const resolved = await resolveWsTargetFromPort(port, {
      userDataDirs: [userDataDir],
    });

    expect(resolved).toBe(liveWsUrl);
  });

  it("discoverLocalCdp skips a stale DevToolsActivePort candidate and falls back to a live fallback-port probe", async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), "browse-cdp-discover-"));
    tempDirs.push(userDataDir);

    const {
      port,
      wsUrl: liveWsUrl,
      close,
    } = await startFakeCdpServer(
      (p) => `ws://127.0.0.1:${p}/devtools/browser/live-id`,
    );
    servers.push(close);

    await writeDevToolsActivePort(
      userDataDir,
      port,
      "/devtools/browser/stale-id",
    );

    const discovered = await discoverLocalCdp({
      userDataDirs: [userDataDir],
      fallbackPorts: [port],
    });

    expect(discovered?.wsUrl).toBe(liveWsUrl);
    expect(discovered?.source).toBe(`port:${port}`);
  });

  it('resolveWsTargetFromPort trusts a live browser that reports "localhost" instead of "127.0.0.1"', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), "browse-cdp-host-"));
    tempDirs.push(userDataDir);

    // Chrome's /json/version response can echo back whichever host the
    // request used (or a fixed default), so a live browser can legitimately
    // report "localhost" even though we always probe via 127.0.0.1.
    const { port, close } = await startFakeCdpServer(
      (p) => `ws://localhost:${p}/devtools/browser/current-id`,
    );
    servers.push(close);

    await writeDevToolsActivePort(
      userDataDir,
      port,
      "/devtools/browser/current-id",
    );

    const resolved = await resolveWsTargetFromPort(port, {
      userDataDirs: [userDataDir],
    });

    // The cached candidate is still trusted (built from the recorded
    // port + wsPath), since only the path -- not the host string -- is used
    // to confirm freshness.
    expect(resolved).toBe(`ws://127.0.0.1:${port}/devtools/browser/current-id`);
  });

  it("discoverLocalCdp probes a port shared by a cached candidate and a fallback port only once", async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), "browse-cdp-memo-"));
    tempDirs.push(userDataDir);

    const {
      port,
      wsUrl: liveWsUrl,
      close,
      requestCount,
    } = await startFakeCdpServer(
      (p) => `ws://127.0.0.1:${p}/devtools/browser/live-id`,
    );
    servers.push(close);

    // The same port shows up both as a (stale) cached candidate and as a
    // fallback port -- discovery should only hit /json/version once for it.
    await writeDevToolsActivePort(
      userDataDir,
      port,
      "/devtools/browser/stale-id",
    );

    const discovered = await discoverLocalCdp({
      userDataDirs: [userDataDir],
      fallbackPorts: [port],
    });

    expect(discovered?.wsUrl).toBe(liveWsUrl);
    expect(requestCount()).toBe(1);
  });

  it("discoverLocalCdp returns null when no candidate is live", async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), "browse-cdp-none-"));
    tempDirs.push(userDataDir);

    await writeDevToolsActivePort(userDataDir, 9, "/devtools/browser/dead");

    const discovered = await discoverLocalCdp({
      userDataDirs: [userDataDir],
      fallbackPorts: [],
    });

    expect(discovered).toBeNull();
  });
});
