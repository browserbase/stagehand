/**
 * Response
 * -----------------
 *
 * This module implements a Playwright-inspired response wrapper that exposes
 * navigation metadata and helpers for retrieving HTTP response bodies. The
 * abstraction is consumed by navigation routines (e.g. `Page.goto`) so callers
 * can synchronously inspect status codes, lazily fetch body text, or await the
 * network layer finishing the request. The implementation is built directly on
 * Chrome DevTools Protocol primitives – it holds the originating `requestId`
 * so it can request payloads via `Network.getResponseBody`, and it listens for
 * `responseReceivedExtraInfo`, `loadingFinished`, and `loadingFailed` events to
 * hydrate the richer header view and resolve callers waiting on completion.
 */

import type { Protocol } from "devtools-protocol";
import type { SerializableResponse } from "../types/private/index.js";
import {
  ResponseBodyError,
  ResponseParseError,
} from "../types/public/sdkErrors.js";
import type { CDPSessionLike } from "./cdp.js";
import type { Frame } from "./frame.js";
import type { Page } from "./page.js";

type ServerAddr = { ipAddress: string; port: number };

export function isSerializableResponse(
  value: unknown,
): value is SerializableResponse {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SerializableResponse>;
  if (typeof candidate.requestId !== "string") return false;
  if (!candidate.response || typeof candidate.response !== "object") {
    return false;
  }
  return true;
}

/**
 * Minimal deferred helper that lets navigation tracking hand out a promise and
 * later control the resolution from event callbacks. Each response owns a
 * single deferred covering the "finished" promise so consumers can mirror
 * Playwright's `response.finished()` behaviour.
 */
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

/** Normalise header names to lowercase for case-insensitive lookups. */
function normaliseHeaderName(name: string): string {
  return name.toLowerCase();
}

/** Split multi-value header strings into discrete values while trimming. */
function splitHeaderValues(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Parse an HTTP header text block (as emitted by CDP) into an ordered array of
 * name/value pairs while preserving the wire casing.
 */
function parseHeadersText(
  headersText: string | undefined,
): Array<{ name: string; value: string }> {
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

/**
 * Thin wrapper around CDP response metadata that mirrors the ergonomics of
 * Playwright's `Response` class. The class intentionally keeps the same method
 * names so upstream integrations can transition with minimal code changes.
 */
export class Response {
  private readonly page: Page;
  private readonly session: CDPSessionLike;
  private readonly requestId: string;
  private readonly frameId?: string;
  private readonly loaderId?: string;
  private readonly response: Protocol.Network.Response;
  private readonly fromServiceWorkerFlag: boolean;
  private readonly serverAddress?: ServerAddr | null;

  private headersObject: Record<string, string>;
  private headersArrayCache: Array<{ name: string; value: string }> | null =
    null;
  private allHeadersCache: Record<string, string> | null = null;
  private readonly headerValuesMap = new Map<string, string[]>();

  private finishedDeferred = createDeferred<null | Error>();
  private finishedSettled = false;

  private extraInfoHeaders: Protocol.Network.Headers | null = null;
  private extraInfoHeadersText: string | undefined;

  /**
   * Build a response wrapper from the CDP notification associated with a
   * navigation. The constructor captures the owning page/session so follow-up
   * methods (body/text/json) can query CDP on-demand. The `response` payload is
   * the raw `Protocol.Network.Response` object emitted by Chrome.
   */
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
    this.session = params.session;
    this.requestId = params.requestId;
    this.frameId = params.frameId;
    this.loaderId = params.loaderId;
    this.response = params.response;
    this.fromServiceWorkerFlag = params.fromServiceWorker;

    if (
      params.response.remoteIPAddress &&
      params.response.remotePort !== undefined
    ) {
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
  }

  /** URL associated with the navigation request. */
  url(): string {
    return this.response.url;
  }

  /** HTTP status code reported by Chrome. */
  status(): number {
    return this.response.status;
  }

  /** Human-readable status text that accompanied the response. */
  statusText(): string {
    return this.response.statusText;
  }

  /** Convenience predicate that checks for 2xx statuses. */
  ok(): boolean {
    const status = this.status();
    return status >= 200 && status <= 299;
  }

  /** Returns the Stagehand frame object that initiated the navigation. */
  frame(): Frame | null {
    if (!this.frameId) return null;
    try {
      return this.page.frameForId(this.frameId);
    } catch {
      return null;
    }
  }

  /** Indicates whether the response was serviced by a Service Worker. */
  fromServiceWorker(): boolean {
    return this.fromServiceWorkerFlag;
  }

  /**
   * Returns TLS security metadata when provided by the browser. In practice
   * this includes certificate issuer, protocol, and validity interval.
   */
  async securityDetails(): Promise<Protocol.Network.SecurityDetails | null> {
    return this.response.securityDetails ?? null;
  }

  /** Returns the resolved server address for the navigation when available. */
  async serverAddr(): Promise<ServerAddr | null> {
    return this.serverAddress ?? null;
  }

  /**
   * Returns the response headers normalised to lowercase keys. Matches the
   * behaviour of Playwright's `headers()` by eliding duplicate header entries.
   */
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

  /** Returns a concatenated header string for the supplied header name. */
  async headerValue(name: string): Promise<string | null> {
    const values = await this.headerValues(name);
    if (!values.length) return null;
    return values.join(", ");
  }

  /** Returns all values for a header (case-insensitive lookup). */
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

  /**
   * Returns header entries preserving their original wire casing and ordering.
   * Falls back to the CDP object when the raw header text is unavailable.
   */
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
  async body(): Promise<Buffer> {
    const result = await this.session
      .send<Protocol.Network.GetResponseBodyResponse>(
        "Network.getResponseBody",
        { requestId: this.requestId },
      )
      .catch((error) => {
        throw new ResponseBodyError(String(error));
      });

    if (result.base64Encoded) {
      return Buffer.from(result.body, "base64");
    }
    return Buffer.from(result.body, "utf-8");
  }

  /** Decodes the response body as UTF-8 text. */
  async text(): Promise<string> {
    const buffer = await this.body();
    return buffer.toString("utf-8");
  }

  /** Parses the response body as JSON and throws if parsing fails. */
  async json<T = unknown>(): Promise<T> {
    const text = await this.text();
    try {
      return JSON.parse(text) as T;
    } catch (error) {
      throw new ResponseParseError(String(error));
    }
  }

  /**
   * Resolves once the underlying network request completes or fails. Mirrors
   * Playwright's behaviour by resolving to `null` on success and to an `Error`
   * instance when Chrome reports `Network.loadingFailed`.
   */
  async finished(): Promise<null | Error> {
    return this.finishedDeferred.promise;
  }

  /**
   * Internal helper invoked by the navigation tracker when CDP reports extra
   * header information. This keeps the cached header views in sync with the
   * richer metadata.
   */
  public applyExtraInfo(
    event: Protocol.Network.ResponseReceivedExtraInfoEvent,
  ): void {
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

  /**
   * Internal helper for creating a Response object from a Serializable
   * goto response from the Stagehand API
   */
  public static fromSerializable(
    serialized: SerializableResponse,
    context: { page: Page; session: CDPSessionLike },
  ): Response {
    const reconstructed = new Response({
      page: context.page,
      session: context.session,
      requestId: serialized.requestId,
      frameId: serialized.frameId,
      loaderId: serialized.loaderId,
      response: serialized.response as Protocol.Network.Response,
      fromServiceWorker: serialized.fromServiceWorkerFlag ?? false,
    });

    if (serialized.extraInfoHeaders) {
      reconstructed.applyExtraInfo({
        requestId: serialized.requestId,
        headers: serialized.extraInfoHeaders,
        headersText: serialized.extraInfoHeadersText,
      } as Protocol.Network.ResponseReceivedExtraInfoEvent);
    }

    if (serialized.finishedSettled) {
      reconstructed.markFinished(null);
    }

    return reconstructed;
  }

  /** Marks the response as finished and resolves the `finished()` promise. */
  public markFinished(error: Error | null): void {
    if (this.finishedSettled) return;
    this.finishedSettled = true;
    if (error) {
      this.finishedDeferred.resolve(error);
    } else {
      this.finishedDeferred.resolve(null);
    }
  }
}
