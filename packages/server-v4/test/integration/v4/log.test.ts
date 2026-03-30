import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import {
  assertFetchOk,
  assertFetchStatus,
  createSession,
  endSession,
  fetchWithContext,
  getBaseUrl,
  getHeaders,
  HTTP_BAD_REQUEST,
  HTTP_OK,
} from "../utils.js";

interface LogEventRecord {
  eventId: string;
  eventParentIds: string[];
  createdAt: string;
  sessionId: string;
  eventType: string;
  data?: unknown;
}

interface LogResponseBody {
  success: boolean;
  message?: string;
  data?: {
    events: LogEventRecord[];
  };
}

const headers = getHeaders("4.0.0");

const LOG_TEST_URL = `data:text/html;charset=utf-8,${encodeURIComponent(`
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>V4 log route</title>
  </head>
  <body>
    <main id="message">log-ok</main>
  </body>
</html>
`)}`;

async function postPageGoto(sessionId: string) {
  return fetchWithContext<{
    success: boolean;
    action?: { id: string; method: string; status: string };
  }>(`${getBaseUrl()}/v4/page/goto`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      sessionId,
      url: LOG_TEST_URL,
      waitUntil: "load",
    }),
  });
}

async function readLogStreamUntil(
  sessionId: string,
  predicate: (events: LogEventRecord[]) => boolean,
): Promise<LogEventRecord[]> {
  const response = await fetch(
    `${getBaseUrl()}/v4/log?sessionId=${encodeURIComponent(sessionId)}&eventType=${encodeURIComponent("PageGoto*")}&follow=true`,
    {
      method: "GET",
      headers,
    },
  );

  assert.equal(response.status, HTTP_OK);
  assert.ok(
    response.headers.get("content-type")?.startsWith("text/event-stream"),
    `Expected text/event-stream response, got ${response.headers.get("content-type")}`,
  );

  const reader = response.body?.getReader();
  assert.ok(reader, "Expected an SSE response body");

  const decoder = new TextDecoder();
  const events: LogEventRecord[] = [];
  let buffer = "";
  const deadline = Date.now() + 10_000;

  for (;;) {
    const timeoutMs = deadline - Date.now();
    assert.ok(timeoutMs > 0, "Timed out waiting for /v4/log SSE events");

    const result = await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error("Timed out waiting for /v4/log SSE chunk"));
        }, timeoutMs).unref();
      }),
    ]);

    if (result.done) {
      break;
    }

    buffer += decoder.decode(result.value, { stream: true });

    for (;;) {
      const separatorIndex = buffer.indexOf("\n\n");
      if (separatorIndex === -1) {
        break;
      }

      const chunk = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);

      if (!chunk.startsWith("data: ")) {
        continue;
      }

      const event = JSON.parse(chunk.slice("data: ".length)) as LogEventRecord;
      events.push(event);

      if (predicate(events)) {
        await reader.cancel();
        return events;
      }
    }
  }

  await reader.cancel();
  throw new Error("Log stream closed before expected events were received");
}

describe("v4 log route", { concurrency: false }, () => {
  let sessionId: string;

  before(async () => {
    sessionId = await createSession(headers);
  });

  after(async () => {
    await endSession(sessionId, headers);
  });

  it("GET /v4/log validates that a scope filter is required", async () => {
    const ctx = await fetchWithContext<LogResponseBody>(
      `${getBaseUrl()}/v4/log`,
      {
        method: "GET",
        headers,
      },
    );

    assertFetchStatus(ctx, HTTP_BAD_REQUEST);
    assertFetchOk(ctx.body !== null, "Expected a JSON response body", ctx);
    assert.equal(ctx.body.success, false);
    assert.equal(ctx.body.message, "Request validation failed");
  });

  it("GET /v4/log returns stored session events", async () => {
    const gotoCtx = await postPageGoto(sessionId);
    assertFetchStatus(gotoCtx, HTTP_OK);

    const ctx = await fetchWithContext<LogResponseBody>(
      `${getBaseUrl()}/v4/log?sessionId=${encodeURIComponent(sessionId)}&eventType=${encodeURIComponent("PageGoto*")}`,
      {
        method: "GET",
        headers,
      },
    );

    assertFetchStatus(ctx, HTTP_OK);
    assertFetchOk(ctx.body !== null, "Expected a JSON response body", ctx);
    assert.equal(ctx.body.success, true);
    assert.ok(ctx.body.data);
    assert.ok(ctx.body.data.events.length >= 2);
    assert.ok(
      ctx.body.data.events.some((event) => event.eventType === "PageGotoEvent"),
    );
    assert.ok(
      ctx.body.data.events.some(
        (event) => event.eventType === "PageGotoCompletedEvent",
      ),
    );
  });

  it("GET /v4/log streams live session events over SSE", async () => {
    const liveSessionId = await createSession(headers);

    const streamPromise = readLogStreamUntil(
      liveSessionId,
      (events) =>
        events.some((event) => event.eventType === "PageGotoEvent") &&
        events.some((event) => event.eventType === "PageGotoCompletedEvent"),
    );

    try {
      const gotoCtx = await postPageGoto(liveSessionId);
      assertFetchStatus(gotoCtx, HTTP_OK);

      const events = await streamPromise;
      assert.ok(events.length >= 2);
      assert.ok(events.some((event) => event.eventType === "PageGotoEvent"));
      assert.ok(
        events.some((event) => event.eventType === "PageGotoCompletedEvent"),
      );
    } finally {
      await endSession(liveSessionId, headers);
    }
  });
});
