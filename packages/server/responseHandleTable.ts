import type { Response } from "./understudy/response.js";

const DEFAULT_MAX_RESPONSE_HANDLES = 10_000;

export type ResponseHandleTableOptions = {
  maxHandles?: number;
  createHandle?: () => string;
};

type ResponseHandleEntry = {
  pageId: string;
  response: Response;
};

export class ResponseHandleNotFoundError extends Error {
  constructor(responseId: string) {
    super(`Response handle "${responseId}" is unavailable`);
    this.name = "ResponseHandleNotFoundError";
  }
}

/**
 * Retains live understudy responses for one Stagehand runtime. Handles are
 * opaque RPC identities; CDP request and session identifiers never leave the
 * server-side Response object.
 */
export class ResponseHandleTable {
  private readonly entries = new Map<string, ResponseHandleEntry>();
  private readonly maxHandles: number;
  private readonly createHandle: () => string;

  constructor(options: ResponseHandleTableOptions = {}) {
    this.maxHandles = options.maxHandles ?? DEFAULT_MAX_RESPONSE_HANDLES;
    this.createHandle = options.createHandle ?? (() => globalThis.crypto.randomUUID());

    if (!Number.isInteger(this.maxHandles) || this.maxHandles <= 0) {
      throw new RangeError("Response handle capacity must be a positive integer");
    }
  }

  get size(): number {
    return this.entries.size;
  }

  register(pageId: string, response: Response): string {
    const responseId = this.nextHandle();
    while (this.entries.size >= this.maxHandles) {
      const oldestResponseId = this.entries.keys().next().value as string | undefined;
      if (oldestResponseId === undefined) break;
      this.entries.delete(oldestResponseId);
    }
    this.entries.set(responseId, { pageId, response });
    return responseId;
  }

  resolve(responseId: string): Response {
    const entry = this.entries.get(responseId);
    if (!entry) throw new ResponseHandleNotFoundError(responseId);
    return entry.response;
  }

  deleteForPage(pageId: string): void {
    for (const [responseId, entry] of this.entries) {
      if (entry.pageId === pageId) this.entries.delete(responseId);
    }
  }

  clear(): void {
    this.entries.clear();
  }

  private nextHandle(): string {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const responseId = this.createHandle();
      if (responseId && !this.entries.has(responseId)) return responseId;
    }
    throw new Error("Could not allocate a unique response handle");
  }
}
