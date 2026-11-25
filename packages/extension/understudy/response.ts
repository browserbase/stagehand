import type { Protocol } from "devtools-protocol";
import type { CDPSessionLike } from "./cdp.js";
import type { Frame } from "./frame.js";
import type { Page } from "./page.js";

type ServerAddr = { ipAddress: string; port: number };

function base64ToBytes(base64: string): Uint8Array {
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function normaliseHeaderName(name: string): string {
  return name.toLowerCase();
}

function splitHeaderValues(value: string): string[] {
  return value.split(/\r?\n/).map((part) => part.trim());
}

function parseHeadersText(headersText: string | undefined): Array<{ name: string; value: string }> {
  if (!headersText) return [];
  const lines = headersText.split(/\r?\n/);
  const entries: Array<{ name: string; value: string }> = [];
  for (const line of lines) {
    if (!line || line.startsWith("HTTP/")) continue;
    const index = line.indexOf(":");
    if (index === -1) continue;
    const name = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    entries.push({ name, value });
  }
  return entries;
}

// TODO(protocol): Keep this class internal. If clients need navigation response
// metadata, define a JSON-safe Zod result in protocol and map this live CDP
// state into that result instead of exposing this object.
export function isMatchingExtraInfoStatus(
  responseStatus: number | undefined,
  extraStatus: number | undefined,
): boolean {
  if (extraStatus === undefined || responseStatus === undefined) return true;
  if (extraStatus === responseStatus) return true;
  // CDP reports 200 on responseReceived and 304 on responseReceivedExtraInfo for cached revalidation.
  return responseStatus === 200 && extraStatus === 304;
}

export class Response {
  readonly page: Page;
  private _session: CDPSessionLike;
  readonly requestId: string;
  readonly frameId?: string;
  readonly loaderId?: string;
  readonly response: Protocol.Network.Response;
  readonly fromServiceWorkerFlag: boolean;
  readonly serverAddress?: ServerAddr | null;

  headersObject: Record<string, string>;
  headersArrayCache: Array<{ name: string; value: string }> | null = null;
  allHeadersCache: Record<string, string> | null = null;
  readonly headerValuesMap = new Map<string, string[]>();

  finishedDeferred = createDeferred<null | Error>();
  finishedSettled = false;
  private bodyPromise: Promise<Uint8Array> | null = null;

  private readonly onResponseReceivedExtraInfo = (
    event: Protocol.Network.ResponseReceivedExtraInfoEvent,
  ): void => {
    if (event?.requestId !== this.requestId) return;
    if (!isMatchingExtraInfoStatus(this.response.status, event.statusCode)) {
      return;
    }
    this.applyExtraInfo(event);
  };

  private readonly onLoadingFinished = (event: Protocol.Network.LoadingFinishedEvent): void => {
    if (event?.requestId !== this.requestId) return;
    this.markFinished(null);
  };

  private readonly onLoadingFailed = (event: Protocol.Network.LoadingFailedEvent): void => {
    if (event?.requestId !== this.requestId) return;
    this.markFinished(new Error(event.errorText || "Navigation request failed"));
  };

  extraInfoHeaders: Protocol.Network.Headers | null = null;
  extraInfoHeadersText: string | undefined;

  constructor(params: {
    page: Page;
    session: CDPSessionLike;
    requestId: string;
    frameId?: string;
    loaderId?: string;
    response: Protocol.Network.Response;
    fromServiceWorker: boolean;
  }) {
    this.page = params.page;
    this._session = params.session;
    this.requestId = params.requestId;
    this.frameId = params.frameId;
    this.loaderId = params.loaderId;
    this.response = params.response;
    this.fromServiceWorkerFlag = params.fromServiceWorker;

    if (params.response.remoteIPAddress && params.response.remotePort !== undefined) {
      this.serverAddress = {
        ipAddress: params.response.remoteIPAddress,
        port: params.response.remotePort,
      };
    } else {
      this.serverAddress = null;
    }

    this.headersObject = {};
    for (const [name, value] of Object.entries(this.response.headers ?? {})) {
      const lower = normaliseHeaderName(name);
      if (value === undefined) continue;
      const values = splitHeaderValues(String(value));
      this.headerValuesMap.set(lower, values);
      this.headersObject[lower] = values.join(", ");
    }

    this.installLifecycleListeners();
  }

  url(): string {
    return this.response.url;
  }

  status(): number {
    return this.response.status;
  }

  statusText(): string {
    return this.response.statusText;
  }

  ok(): boolean {
    const status = this.status();
    return status >= 200 && status <= 299;
  }

  frame(): Frame | null {
    if (!this.frameId) return null;
    try {
      return this.page.frameForId(this.frameId);
    } catch {
      return null;
    }
  }

  fromServiceWorker(): boolean {
    return this.fromServiceWorkerFlag;
  }

  async securityDetails(): Promise<Protocol.Network.SecurityDetails | null> {
    return this.response.securityDetails ?? null;
  }

  async serverAddr(): Promise<ServerAddr | null> {
    return this.serverAddress ?? null;
  }

  headers(): Record<string, string> {
    return { ...this.headersObject };
  }

  /**
   * Returns all headers including those only surfaced through
   * `responseReceivedExtraInfo` such as `set-cookie`. Values are reported as the
   * browser sends them (no further splitting or concatenation).
   */
  async allHeaders(): Promise<Record<string, string>> {
    if (this.allHeadersCache) return { ...this.allHeadersCache };
    const source = this.extraInfoHeaders ?? this.response.headers ?? {};
    const map: Record<string, string> = {};
    for (const [name, value] of Object.entries(source)) {
      map[name] = String(value);
    }
    this.allHeadersCache = map;
    return { ...map };
  }

  async headerValue(name: string): Promise<string | null> {
    const values = await this.headerValues(name);
    if (!values.length) return null;
    return values.join(", ");
  }

  async headerValues(name: string): Promise<string[]> {
    const lower = normaliseHeaderName(name);
    if (this.extraInfoHeaders) {
      const raw = this.extraInfoHeaders[name] ?? this.extraInfoHeaders[lower];
      if (raw !== undefined) {
        return splitHeaderValues(String(raw));
      }
    }
    const values = this.headerValuesMap.get(lower);
    return values ? [...values] : [];
  }

  async headersArray(): Promise<Array<{ name: string; value: string }>> {
    if (this.headersArrayCache) return [...this.headersArrayCache];

    const entriesFromText = parseHeadersText(this.extraInfoHeadersText);
    if (entriesFromText.length > 0) {
      this.headersArrayCache = entriesFromText;
      return [...entriesFromText];
    }

    const entries: Array<{ name: string; value: string }> = [];
    const source = this.extraInfoHeaders ?? this.response.headers ?? {};
    for (const [name, value] of Object.entries(source)) {
      const values = splitHeaderValues(String(value));
      for (const val of values) {
        entries.push({ name, value: val });
      }
    }
    this.headersArrayCache = entries;
    return [...entries];
  }

  /**
   * Requests the raw response body from Chrome DevTools Protocol. The method is
   * intentionally lazy because not every caller needs the payload, and CDP only
   * allows retrieving it once the response completes.
   */
  body(): Promise<Uint8Array> {
    this.bodyPromise ??= this.loadBody();
    return this.bodyPromise;
  }

  private async loadBody(): Promise<Uint8Array> {
    const finishedError = await this.finished();
    if (finishedError) throw finishedError;

    const result = await this.session.send<Protocol.Network.GetResponseBodyResponse>(
      "Network.getResponseBody",
      {
        requestId: this.requestId,
      },
    );

    if (result.base64Encoded) {
      return base64ToBytes(result.body);
    }
    return new TextEncoder().encode(result.body);
  }

  async text(): Promise<string> {
    const bytes = await this.body();
    return new TextDecoder().decode(bytes);
  }

  async json<T = unknown>(): Promise<T> {
    const text = await this.text();
    return JSON.parse(text) as T;
  }

  async finished(): Promise<null | Error> {
    return this.finishedDeferred.promise;
  }

  public applyExtraInfo(event: Protocol.Network.ResponseReceivedExtraInfoEvent): void {
    this.extraInfoHeaders = event.headers;
    this.extraInfoHeadersText = event.headersText;
    this.allHeadersCache = null;
    this.headersArrayCache = null;
    this.headersObject = {};
    this.headerValuesMap.clear();

    const source = event.headers ?? {};
    for (const [name, value] of Object.entries(source)) {
      const lower = normaliseHeaderName(name);
      const segments = splitHeaderValues(String(value));
      this.headerValuesMap.set(lower, segments);
      this.headersObject[lower] = segments.join(", ");
    }
  }

  get session(): CDPSessionLike {
    return this._session;
  }

  public updateSession(session: CDPSessionLike): void {
    if (this.finishedSettled || session === this._session) return;
    this.removeLifecycleListeners();
    this._session = session;
    this.installLifecycleListeners();
  }

  public markFinished(error: Error | null): void {
    if (this.finishedSettled) return;
    this.finishedSettled = true;
    this.removeLifecycleListeners();
    if (error) {
      this.finishedDeferred.resolve(error);
    } else {
      this.finishedDeferred.resolve(null);
    }
  }

  public dispose(error = new Error("Response was disposed")): void {
    this.markFinished(error);
  }

  private installLifecycleListeners(): void {
    this.session.on("Network.responseReceivedExtraInfo", this.onResponseReceivedExtraInfo);
    this.session.on("Network.loadingFinished", this.onLoadingFinished);
    this.session.on("Network.loadingFailed", this.onLoadingFailed);
  }

  private removeLifecycleListeners(): void {
    this.session.off("Network.responseReceivedExtraInfo", this.onResponseReceivedExtraInfo);
    this.session.off("Network.loadingFinished", this.onLoadingFinished);
    this.session.off("Network.loadingFailed", this.onLoadingFailed);
  }
}
