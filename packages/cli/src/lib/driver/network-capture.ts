import type { PageNetworkEvent } from "@browserbasehq/stagehand";
import { promises as fs } from "node:fs";
import path from "node:path";

import {
  ensurePrivateDir,
  ensureRuntimeDir,
  getNetworkDir,
  writePrivateFile,
} from "./daemon/paths.js";

interface PendingRequest {
  body: string | null;
  headers: Record<string, string>;
  id: string;
  method: string;
  resourceType: string;
  timestamp: string;
  url: string;
}

type NetworkEventPage = {
  on(
    event: "network",
    listener: (event: PageNetworkEvent) => void,
  ): Promise<NetworkSubscription>;
};

type NetworkSubscription = {
  unsubscribe(): Promise<void>;
};

export class NetworkCapture {
  private counter = 0;
  private enabled = false;
  private readonly requestDirs = new Map<string, Promise<string | null>>();
  private networkDir: string | null = null;
  private subscription: NetworkSubscription | null = null;

  constructor(private readonly session: string) {}

  async enable(
    page: NetworkEventPage,
  ): Promise<{ alreadyEnabled?: boolean; enabled: true; path: string }> {
    if (this.enabled && this.networkDir) {
      return { alreadyEnabled: true, enabled: true, path: this.networkDir };
    }

    await ensureRuntimeDir();
    this.networkDir = getNetworkDir(this.session);
    await ensurePrivateDir(this.networkDir);
    this.counter = 0;
    this.requestDirs.clear();
    this.enabled = true;

    try {
      this.subscription = await page.on("network", (event) => {
        void this.handleEvent(event);
      });
    } catch (error) {
      this.enabled = false;
      throw error;
    }

    return { enabled: true, path: this.networkDir };
  }

  async disable(): Promise<{
    alreadyDisabled?: boolean;
    enabled: false;
    path: string | null;
  }> {
    if (!this.enabled) {
      return { alreadyDisabled: true, enabled: false, path: this.networkDir };
    }

    const subscription = this.subscription;
    this.enabled = false;
    try {
      await subscription?.unsubscribe();
    } catch (error) {
      this.enabled = true;
      throw error;
    }
    this.subscription = null;
    this.requestDirs.clear();
    return { enabled: false, path: this.networkDir };
  }

  path(): { enabled: boolean; path: string } {
    return {
      enabled: this.enabled,
      path: this.networkDir ?? getNetworkDir(this.session),
    };
  }

  async clear(): Promise<{ cleared: boolean; error?: string; path: string }> {
    const dir = this.networkDir ?? getNetworkDir(this.session);
    try {
      await ensurePrivateDir(dir);
      const entries = await fs.readdir(dir, { withFileTypes: true });
      await Promise.all(
        entries
          .filter((entry) => entry.isDirectory())
          .map((entry) =>
            fs.rm(path.join(dir, entry.name), { recursive: true }),
          ),
      );
      this.counter = 0;
      this.requestDirs.clear();
      return { cleared: true, path: dir };
    } catch (error) {
      return {
        cleared: false,
        error: error instanceof Error ? error.message : String(error),
        path: dir,
      };
    }
  }

  private async handleEvent(event: PageNetworkEvent): Promise<void> {
    if (!this.enabled || !this.networkDir) return;
    if (event.method === "Network.requestWillBeSent") {
      const request: PendingRequest = {
        body: event.params.body,
        headers: event.params.headers,
        id: event.params.requestId,
        method: event.params.httpMethod,
        resourceType: event.params.resourceType,
        timestamp: event.params.timestamp,
        url: event.params.url,
      };
      const requestDir = this.writeRequest(request).catch(() => null);
      this.requestDirs.set(event.params.requestKey, requestDir);
      return;
    }

    const requestDir = await this.requestDirs.get(event.params.requestKey);
    if (!requestDir) {
      this.requestDirs.delete(event.params.requestKey);
      return;
    }

    if (event.method === "Network.loadingFailed") {
      await this.writeResponse(requestDir, {
        body: null,
        duration: event.params.durationMs,
        error: event.params.errorText,
        headers: {},
        id: event.params.requestId,
        mimeType: "",
        status: 0,
        statusText: "Failed",
      });
    } else {
      const body =
        event.params.base64Encoded && event.params.body
          ? `[base64] ${event.params.body.slice(0, 100)}...`
          : event.params.body;
      await this.writeResponse(requestDir, {
        body,
        duration: event.params.durationMs,
        headers: event.params.headers,
        id: event.params.requestId,
        mimeType: event.params.mimeType,
        status: event.params.status,
        statusText: event.params.statusText,
      });
    }
    this.requestDirs.delete(event.params.requestKey);
  }

  private async writeRequest(request: PendingRequest): Promise<string | null> {
    if (!this.networkDir) return null;
    const requestDir = path.join(
      this.networkDir,
      getRequestDirName(this.counter++, request.method, request.url),
    );
    await ensurePrivateDir(requestDir);
    await writePrivateFile(
      path.join(requestDir, "request.json"),
      JSON.stringify(request, null, 2),
    );
    return requestDir;
  }

  private async writeResponse(
    requestDir: string,
    response: {
      body: string | null;
      duration: number;
      error?: string;
      headers: Record<string, string>;
      id: string;
      mimeType: string;
      status: number;
      statusText: string;
    },
  ): Promise<void> {
    await writePrivateFile(
      path.join(requestDir, "response.json"),
      JSON.stringify(response, null, 2),
    ).catch(() => undefined);
  }
}

function getRequestDirName(
  counter: number,
  method: string,
  url: string,
): string {
  try {
    const parsed = new URL(url);
    const domain = sanitizeForFilename(parsed.hostname, 30);
    const pathPart = sanitizeForFilename(
      parsed.pathname.split("/").filter(Boolean)[0] || "root",
      20,
    );
    return `${String(counter).padStart(3, "0")}-${method}-${domain}-${pathPart}`;
  } catch {
    return `${String(counter).padStart(3, "0")}-${method}-unknown`;
  }
}

function sanitizeForFilename(value: string, maxLen: number): string {
  return value
    .replace(/[^a-zA-Z0-9.-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, maxLen);
}
