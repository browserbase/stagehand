import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { CDPSession, Page } from "playwright";

/**
 * Network tier for recorded tasks (issue #2841). The static observation tier freezes what
 * Stagehand reads; it has nothing to run, so `act()` bugs that live in what happens after the
 * click (the handler fetches, the page re-renders) can't reproduce from it. This tier records the
 * responses the page actually received, in the same browser session, and replays them to the
 * page's own scripts.
 *
 * - Recording pauses each response at the CDP Fetch response stage and reads its body with
 *   `Fetch.getResponseBody`: no second fetch, so the task holds the bytes the run got.
 * - Replay answers every request with `Fetch.fulfillRequest`. A request the recording doesn't
 *   contain fails (`BlockedByClient`) and is reported as a miss. A miss never falls through to
 *   the network, or the test would quietly become a live-site test again. The one exception is
 *   an unrecorded `/favicon.ico`, which browsers request on their own: it gets a 404.
 * - Requests are matched on method, URL and a hash of the request body, so single-endpoint
 *   JSON/GraphQL POSTs don't collide. Cache-buster query parameters are dropped from the key, and
 *   the remaining parameters are sorted. Repeated requests with one key get their responses in
 *   recorded order; after the last one, the last response repeats.
 * - Service workers and the HTTP cache are bypassed in both modes, because either one answers
 *   requests outside the Fetch domain.
 */

/** Query parameters dropped from the match key by default (cache busters, timestamps). */
export const DEFAULT_IGNORED_PARAMS = [
  "_",
  "cb",
  "cachebust",
  "cache_bust",
  "nocache",
  "t",
  "ts",
  "timestamp",
  "rnd",
  "rand",
  "random",
];

/** Response headers that are never stored: credentials, and encodings of a body stored decoded. */
const DROPPED_HEADERS = new Set([
  "set-cookie",
  "set-cookie2",
  "content-encoding",
  "content-length",
  "transfer-encoding",
]);

export interface RecordedResponse {
  /** The match key: method, normalized URL and request-body hash. */
  key: string;
  method: string;
  url: string;
  status: number;
  headers: { name: string; value: string }[];
  /** Base64 of the decoded response body; empty for redirects and bodiless responses. */
  body: string;
}

export interface NetworkRecording {
  version: 1;
  ignoredParams: string[];
  responses: RecordedResponse[];
}

export interface RequestMiss {
  method: string;
  url: string;
  key: string;
}

interface PausedRequest {
  requestId: string;
  request: {
    url: string;
    method: string;
    postData?: string;
    postDataEntries?: { bytes?: string }[];
  };
  responseStatusCode?: number;
  responseHeaders?: { name: string; value: string }[];
  responseErrorReason?: string;
}

/** Method, URL without fragment or ignored parameters (others sorted), and request-body hash. */
export function requestKey(
  request: PausedRequest["request"],
  ignoredParams: string[] = DEFAULT_IGNORED_PARAMS,
): string {
  const url = new URL(request.url);
  url.hash = "";
  const ignored = new Set(ignoredParams);
  const params = [...url.searchParams].filter(([name]) => !ignored.has(name));
  params.sort(([a, av], [b, bv]) => (a === b ? av.localeCompare(bv) : a.localeCompare(b)));
  url.search = new URLSearchParams(params).toString();
  const body = requestBody(request);
  const hash = body.length ? createHash("sha256").update(body).digest("hex").slice(0, 16) : "-";
  return `${request.method} ${url.toString()} ${hash}`;
}

function requestBody(request: PausedRequest["request"]): Buffer {
  if (request.postDataEntries?.length) {
    return Buffer.concat(
      request.postDataEntries.map((entry) => Buffer.from(entry.bytes ?? "", "base64")),
    );
  }
  return Buffer.from(request.postData ?? "", "utf8");
}

async function isolate(session: CDPSession): Promise<void> {
  await session.send("Network.enable");
  await session.send("Network.setBypassServiceWorker", { bypass: true });
  await session.send("Network.setCacheDisabled", { cacheDisabled: true });
}

export interface NetworkRecorder {
  /**
   * Stop recording once the page's network has been quiet for `quietMs` (default 500), or after
   * `timeoutMs` (default 10 s) at the latest, so requests still in flight when the caller is done
   * are captured too.
   */
  stop(options?: { quietMs?: number; timeoutMs?: number }): Promise<NetworkRecording>;
}

/**
 * Record every response `page` receives until `stop()`. Start it before the navigation you want
 * captured. Covers the page's own target: popups, out-of-process frames and workers are not
 * recorded.
 */
export async function recordNetwork(
  page: Page,
  options: { ignoredParams?: string[] } = {},
): Promise<NetworkRecorder> {
  const ignoredParams = options.ignoredParams ?? DEFAULT_IGNORED_PARAMS;
  const session = await page.context().newCDPSession(page);
  const responses: RecordedResponse[] = [];
  const pending = new Set<Promise<void>>();
  // Requests the browser has sent and not finished, so stop() can wait for them.
  const inFlight = new Set<string>();
  let lastActivity = Date.now();
  const onSent = (event: { requestId: string }) => {
    inFlight.add(event.requestId);
    lastActivity = Date.now();
  };
  const onDone = (event: { requestId: string }) => {
    inFlight.delete(event.requestId);
    lastActivity = Date.now();
  };
  const onPaused = (event: PausedRequest) => {
    const work = capture(event).finally(() => pending.delete(work));
    pending.add(work);
  };
  const capture = async (event: PausedRequest) => {
    try {
      if (event.responseErrorReason || event.responseStatusCode === undefined) return;
      const status = event.responseStatusCode;
      let body = "";
      // Redirect responses have no readable body.
      if (status < 300 || status >= 400) {
        const read = (await session.send("Fetch.getResponseBody", {
          requestId: event.requestId,
        })) as { body: string; base64Encoded: boolean };
        body = read.base64Encoded ? read.body : Buffer.from(read.body, "utf8").toString("base64");
      }
      responses.push({
        key: requestKey(event.request, ignoredParams),
        method: event.request.method,
        url: event.request.url,
        status,
        headers: (event.responseHeaders ?? []).filter(
          (header) => !DROPPED_HEADERS.has(header.name.toLowerCase()),
        ),
        body,
      });
    } finally {
      await session.send("Fetch.continueRequest", { requestId: event.requestId }).catch(() => {});
    }
  };
  session.on("Fetch.requestPaused", onPaused);
  session.on("Network.requestWillBeSent", onSent);
  session.on("Network.loadingFinished", onDone);
  session.on("Network.loadingFailed", onDone);
  await isolate(session);
  await session.send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Response" }] });
  return {
    async stop({ quietMs = 500, timeoutMs = 10_000 } = {}) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (inFlight.size === 0 && pending.size === 0 && Date.now() - lastActivity >= quietMs)
          break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      await Promise.all(pending);
      session.off("Fetch.requestPaused", onPaused);
      session.off("Network.requestWillBeSent", onSent);
      session.off("Network.loadingFinished", onDone);
      session.off("Network.loadingFailed", onDone);
      await session.send("Fetch.disable").catch(() => {});
      await session.detach().catch(() => {});
      return { version: 1, ignoredParams, responses };
    },
  };
}

export interface NetworkReplay {
  /** Requests the recording could not answer, in the order they were refused. */
  readonly misses: RequestMiss[];
  stop(): Promise<void>;
}

/**
 * Answer every request `page` makes from `recording`, before any of it reaches the network.
 * Start it before navigating. Check `misses` at the end of a test: a miss means the run asked
 * for something the original run never received.
 */
export async function replayNetwork(
  page: Page,
  recording: NetworkRecording,
): Promise<NetworkReplay> {
  const byKey = new Map<string, RecordedResponse[]>();
  for (const response of recording.responses) {
    byKey.set(response.key, [...(byKey.get(response.key) ?? []), response]);
  }
  const served = new Map<string, number>();
  const misses: RequestMiss[] = [];
  const session = await page.context().newCDPSession(page);
  const onPaused = (event: PausedRequest) => {
    const key = requestKey(event.request, recording.ignoredParams);
    const candidates = byKey.get(key);
    if (!candidates) {
      // Browsers ask for /favicon.ico on their own, and whether they do varies by browser and
      // headless mode: answer it 404 instead of reporting a miss the page never caused.
      if (new URL(event.request.url).pathname === "/favicon.ico") {
        void session
          .send("Fetch.fulfillRequest", { requestId: event.requestId, responseCode: 404 })
          .catch(() => {});
        return;
      }
      misses.push({ method: event.request.method, url: event.request.url, key });
      void session
        .send("Fetch.failRequest", { requestId: event.requestId, errorReason: "BlockedByClient" })
        .catch(() => {});
      return;
    }
    const index = served.get(key) ?? 0;
    served.set(key, index + 1);
    const response = candidates[Math.min(index, candidates.length - 1)]!;
    void session
      .send("Fetch.fulfillRequest", {
        requestId: event.requestId,
        responseCode: response.status,
        responseHeaders: response.headers,
        body: response.body,
      })
      .catch(() => {});
  };
  session.on("Fetch.requestPaused", onPaused);
  await isolate(session);
  await session.send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
  return {
    misses,
    async stop() {
      session.off("Fetch.requestPaused", onPaused);
      await session.send("Fetch.disable").catch(() => {});
      await session.detach().catch(() => {});
    },
  };
}

/** Write a network task: `responses.json` plus a versioned `manifest.json`. Never overwrites. */
export async function writeNetworkTask(
  recording: NetworkRecording,
  output: string,
  meta: { sourceUrl: string; viewport: { width: number; height: number } | null },
): Promise<void> {
  const directory = resolve(output);
  await mkdir(directory);
  try {
    await writeFile(resolve(directory, "responses.json"), JSON.stringify(recording) + "\n");
    await writeFile(
      resolve(directory, "manifest.json"),
      JSON.stringify(
        {
          version: 1,
          kind: "network",
          sourceUrl: meta.sourceUrl,
          recordedAt: new Date().toISOString(),
          viewport: meta.viewport,
          responses: recording.responses.length,
          limitations: [
            "Page target only: no popups, out-of-process frames or workers",
            "No WebSockets or streamed responses",
            "Set-Cookie is not stored; requests are matched without cookies",
            "Unrecorded requests fail during replay",
          ],
        },
        null,
        2,
      ) + "\n",
    );
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

export async function readNetworkTask(directory: string): Promise<NetworkRecording> {
  const recording = JSON.parse(
    await readFile(resolve(directory, "responses.json"), "utf8"),
  ) as NetworkRecording;
  if (recording.version !== 1)
    throw new Error(`Unsupported network task version ${recording.version}`);
  return recording;
}
