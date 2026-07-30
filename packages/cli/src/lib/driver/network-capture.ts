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

interface ResponseMetadata {
  headers: Record<string, string>;
  mimeType: string;
  status: number;
  statusText: string;
}

type CdpSession = {
  off?: (event: string, listener: (...args: unknown[]) => void) => void;
  on: (event: string, listener: (...args: unknown[]) => void) => void;
  send: <T = unknown>(
    method: string,
    params?: Record<string, unknown>,
  ) => Promise<T>;
};

type StagehandPageWithMainFrame = {
  mainFrame: () => { session: CdpSession };
};

export class NetworkCapture {
  private cdpSession: CdpSession | null = null;
  private counter = 0;
  private enabled = false;
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private readonly requestDirs = new Map<string, Promise<string | null>>();
  private readonly requestStartTimes = new Map<string, number>();
  private readonly responseMetadata = new Map<string, ResponseMetadata>();
  private readonly listeners: Array<[string, (...args: unknown[]) => void]> =
    [];
  private networkDir: string | null = null;

  constructor(private readonly session: string) {}

  async enable(
    page: StagehandPageWithMainFrame,
  ): Promise<{ alreadyEnabled?: boolean; enabled: true; path: string }> {
    if (this.enabled && this.networkDir) {
      return { alreadyEnabled: true, enabled: true, path: this.networkDir };
    }

    await ensureRuntimeDir();
    this.networkDir = getNetworkDir(this.session);
    await ensurePrivateDir(this.networkDir);
    this.counter = 0;
    this.pendingRequests.clear();
    this.requestDirs.clear();
    this.requestStartTimes.clear();
    this.responseMetadata.clear();

    const cdpSession = page.mainFrame().session;
    this.cdpSession = cdpSession;
    await cdpSession.send("Network.enable", {
      maxResourceBufferSize: 5_000_000,
      maxTotalBufferSize: 10_000_000,
    });

    this.addListener("Network.requestWillBeSent", (params) => {
      void this.handleRequestWillBeSent(params);
    });
    this.addListener("Network.responseReceived", (params) => {
      this.handleResponseReceived(params);
    });
    this.addListener("Network.loadingFinished", (params) => {
      void this.handleLoadingFinished(params);
    });
    this.addListener("Network.loadingFailed", (params) => {
      void this.handleLoadingFailed(params);
    });

    this.enabled = true;
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

    for (const [event, listener] of this.listeners) {
      this.cdpSession?.off?.(event, listener);
    }
    this.listeners.length = 0;

    await this.cdpSession?.send("Network.disable").catch(() => undefined);
    this.cdpSession = null;
    this.enabled = false;
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
      this.pendingRequests.clear();
      this.requestDirs.clear();
      this.requestStartTimes.clear();
      this.responseMetadata.clear();
      return { cleared: true, path: dir };
    } catch (error) {
      return {
        cleared: false,
        error: error instanceof Error ? error.message : String(error),
        path: dir,
      };
    }
  }

  private addListener(
    event: string,
    listener: (...args: unknown[]) => void,
  ): void {
    this.cdpSession?.on(event, listener);
    this.listeners.push([event, listener]);
  }

  private handleRequestWillBeSent(params: unknown): void {
    if (!this.enabled || !this.networkDir) return;
    const event = params as {
      request?: {
        headers?: Record<string, string>;
        method?: string;
        postData?: string;
        url?: string;
      };
      requestId?: string;
      type?: string;
    };
    if (!event.requestId || !event.request?.url) return;

    const request: PendingRequest = {
      body: event.request.postData ?? null,
      headers: event.request.headers ?? {},
      id: event.requestId,
      method: event.request.method ?? "GET",
      resourceType: event.type ?? "Other",
      timestamp: new Date().toISOString(),
      url: event.request.url,
    };

    this.pendingRequests.set(event.requestId, request);
    this.requestStartTimes.set(event.requestId, Date.now());
    const requestDir = this.writeRequest(request).catch(() => null);
    this.requestDirs.set(event.requestId, requestDir);
  }

  private handleResponseReceived(params: unknown): void {
    const event = params as {
      requestId?: string;
      response?: {
        headers?: Record<string, string>;
        mimeType?: string;
        status?: number;
        statusText?: string;
      };
    };
    if (!event.requestId || !event.response) return;
    this.responseMetadata.set(event.requestId, {
      headers: event.response.headers ?? {},
      mimeType: event.response.mimeType ?? "",
      status: event.response.status ?? 0,
      statusText: event.response.statusText ?? "",
    });
  }

  private async handleLoadingFinished(params: unknown): Promise<void> {
    if (!this.enabled) return;
    const event = params as { requestId?: string };
    if (!event.requestId) return;
    const requestDir = await this.requestDirs.get(event.requestId);
    if (!requestDir) {
      this.forget(event.requestId);
      return;
    }
    const metadata = this.responseMetadata.get(event.requestId);
    const started = this.requestStartTimes.get(event.requestId) ?? Date.now();
    let body: string | null;

    try {
      const result = await this.cdpSession?.send<{
        base64Encoded?: boolean;
        body?: string;
      }>("Network.getResponseBody", {
        requestId: event.requestId,
      });
      body = result?.body ?? null;
      if (result?.base64Encoded && body) {
        body = `[base64] ${body.slice(0, 100)}...`;
      }
    } catch {
      body = null;
    }

    await this.writeResponse(requestDir, {
      body,
      duration: Date.now() - started,
      headers: metadata?.headers ?? {},
      id: event.requestId,
      mimeType: metadata?.mimeType ?? "",
      status: metadata?.status ?? 0,
      statusText: metadata?.statusText ?? "",
    });
    this.forget(event.requestId);
  }

  private async handleLoadingFailed(params: unknown): Promise<void> {
    const event = params as { errorText?: string; requestId?: string };
    if (!event.requestId) return;
    const requestDir = await this.requestDirs.get(event.requestId);
    if (!requestDir) {
      this.forget(event.requestId);
      return;
    }
    const started = this.requestStartTimes.get(event.requestId) ?? Date.now();
    await this.writeResponse(requestDir, {
      body: null,
      duration: Date.now() - started,
      error: event.errorText ?? "Unknown error",
      headers: {},
      id: event.requestId,
      mimeType: "",
      status: 0,
      statusText: "Failed",
    });
    this.forget(event.requestId);
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

  private forget(requestId: string): void {
    this.pendingRequests.delete(requestId);
    this.requestDirs.delete(requestId);
    this.requestStartTimes.delete(requestId);
    this.responseMetadata.delete(requestId);
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
