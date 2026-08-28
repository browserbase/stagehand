import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  NetworkCdpSession,
  NetworkCdpSidecar,
} from "../src/lib/driver/network-cdp-sidecar.js";
import { NetworkCapture } from "../src/lib/driver/network-capture.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  while (cleanupPaths.length > 0) {
    const cleanupPath = cleanupPaths.pop();
    if (cleanupPath) {
      await fs.rm(cleanupPath, { force: true, recursive: true });
    }
  }
});

describe("NetworkCapture", () => {
  it("preserves the V3 files and keeps its sidecar alive across on/off/on", async () => {
    const daemonDir = await fs.mkdtemp(
      join(tmpdir(), "browse-network-sidecar-"),
    );
    cleanupPaths.push(daemonDir);
    const previousDaemonDir = process.env.BROWSE_DAEMON_DIR;
    process.env.BROWSE_DAEMON_DIR = daemonDir;
    const session = new FakeCdpSession();
    const sidecar = {
      attach: vi.fn(async () => session),
      close: vi.fn(),
    };
    const capture = new NetworkCapture(
      "sidecar",
      sidecar as unknown as NetworkCdpSidecar,
    );
    const originalWriteFile = fs.writeFile.bind(fs);
    const writeFileSpy = vi
      .spyOn(fs, "writeFile")
      .mockImplementation(async (...args) => {
        if (String(args[0]).endsWith("request.json")) {
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        return originalWriteFile(...args);
      });

    try {
      await expect(
        capture.enable({ pageId: "page-1" }, "ws://browser.test"),
      ).resolves.toMatchObject({ enabled: true });
      expect(sidecar.attach).toHaveBeenCalledWith(
        "ws://browser.test",
        "page-1",
      );

      session.emit("Network.requestWillBeSent", {
        request: {
          headers: { accept: "text/plain" },
          method: "POST",
          postData: "hello=world",
          url: "https://example.com/fast",
        },
        requestId: "request-1",
        type: "Fetch",
      });
      session.emit("Network.responseReceived", {
        requestId: "request-1",
        response: {
          headers: { "content-type": "text/plain" },
          mimeType: "text/plain",
          status: 200,
          statusText: "OK",
        },
      });
      session.emit("Network.loadingFinished", { requestId: "request-1" });

      const requestDir = join(
        daemonDir,
        "sidecar-network",
        "000-POST-example.com-fast",
      );
      const responsePath = join(requestDir, "response.json");
      await waitForFile(responsePath);
      await expect(
        readJson(join(requestDir, "request.json")),
      ).resolves.toMatchObject({
        body: "hello=world",
        method: "POST",
        resourceType: "Fetch",
        url: "https://example.com/fast",
      });
      await expect(readJson(responsePath)).resolves.toMatchObject({
        body: "ok",
        mimeType: "text/plain",
        status: 200,
        statusText: "OK",
      });

      await expect(capture.disable()).resolves.toMatchObject({
        enabled: false,
      });
      expect(session.detach).toHaveBeenCalledOnce();
      expect(sidecar.close).not.toHaveBeenCalled();

      session.connected = true;
      await capture.enable({ pageId: "page-2" }, "ws://browser.test");
      expect(sidecar.attach).toHaveBeenLastCalledWith(
        "ws://browser.test",
        "page-2",
      );
      expect(sidecar.attach).toHaveBeenCalledTimes(2);

      await capture.close();
      expect(sidecar.close).toHaveBeenCalledOnce();
    } finally {
      writeFileSpy.mockRestore();
      restoreEnv("BROWSE_DAEMON_DIR", previousDaemonDir);
    }
  });
});

class FakeCdpSession implements NetworkCdpSession {
  connected = true;
  readonly detach = vi.fn(async () => {
    this.connected = false;
  });
  private readonly listeners = new Map<
    string,
    Set<(params: unknown) => void>
  >();

  async send<T = unknown>(method: string): Promise<T> {
    if (method === "Network.getResponseBody") {
      return { body: "ok" } as T;
    }
    return {} as T;
  }

  on(event: string, listener: (params: unknown) => void): void {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
  }

  off(event: string, listener: (params: unknown) => void): void {
    this.listeners.get(event)?.delete(listener);
  }

  emit(event: string, params: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) listener(params);
  }
}

async function readJson(filePath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as Record<
    string,
    unknown
  >;
}

async function waitForFile(filePath: string): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < 1_000) {
    try {
      await fs.access(filePath);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error(`Timed out waiting for ${filePath}`);
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
