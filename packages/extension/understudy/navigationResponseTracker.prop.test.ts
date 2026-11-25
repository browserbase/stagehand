import type { Protocol } from "devtools-protocol";
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CDPSessionLike } from "./cdp.js";
import { NavigationResponseTracker } from "./navigationResponseTracker.js";
import type { Page } from "./page.js";
import type { Response } from "./response.js";

class MockSession implements CDPSessionLike {
  readonly id = "nav-session";
  readonly handlers = new Map<string, Set<(event: unknown) => void>>();

  async send<R = unknown>(method: string): Promise<R> {
    if (method === "Network.getResponseBody") {
      return { body: "ok", base64Encoded: false } as R;
    }
    return {} as R;
  }

  on<P = unknown>(event: string, handler: (params: P) => void): void {
    const set = this.handlers.get(event) ?? new Set<(event: unknown) => void>();
    set.add(handler as (event: unknown) => void);
    this.handlers.set(event, set);
  }

  off<P = unknown>(event: string, handler: (params: P) => void): void {
    this.handlers.get(event)?.delete(handler as (event: unknown) => void);
  }

  emit(event: string, payload: unknown): void {
    const snapshot = [...(this.handlers.get(event) ?? [])];
    for (const handler of snapshot) {
      handler(payload);
    }
  }

  listenerCount(): number {
    let total = 0;
    for (const set of this.handlers.values()) total += set.size;
    return total;
  }

  async close(): Promise<void> {}
}

class MockNavPage {
  latestCommandId = 1;
  currentMainFrameId = "main-frame";

  isCurrentNavigationCommand(id: number): boolean {
    return this.latestCommandId === id;
  }

  mainFrameId(): string {
    return this.currentMainFrameId;
  }

  frameForId(): null {
    return null;
  }
}

type UrlKind = "http" | "data" | "about";

type NavCommand =
  | {
      kind: "responseReceived";
      originCommandId: 1 | 2;
      requestId: string;
      loaderId: string | undefined;
      frameId: string;
      type: Protocol.Network.ResourceType;
      urlKind: UrlKind;
      status: number;
    }
  | {
      kind: "responseReceivedExtraInfo";
      requestId: string;
      statusCode: number;
      headerTag: string;
    }
  | {
      kind: "loadingFinished";
      requestId: string;
    }
  | {
      kind: "loadingFailed";
      requestId: string;
      errorText: string;
    }
  | {
      kind: "setExpectedLoaderId";
      trackerIndex: 0 | 1;
      loaderId: string;
    }
  | {
      kind: "expectWithoutLoader";
      trackerIndex: 0 | 1;
    }
  | {
      kind: "startNewNavigation";
    }
  | {
      kind: "swapMainFrame";
      frameId: string;
    }
  | {
      kind: "navigationCompleted";
      trackerIndex: 0 | 1;
    }
  | {
      kind: "dispose";
      trackerIndex: 0 | 1;
    };

const requestIdArb = fc.constantFrom("req-1", "req-2", "req-3");
const nav1LoaderArb = fc.constantFrom("loader-1a", "loader-1b");
const nav2LoaderArb = fc.constantFrom("loader-2a", "loader-2b");
const frameIdArb = fc.constantFrom("main-frame", "main-frame-2", "sub-frame");
const resourceTypeArb = fc.constantFrom<Protocol.Network.ResourceType>(
  "Document",
  "Fetch",
  "Script",
  "Image",
);
const urlKindArb = fc.constantFrom<UrlKind>("http", "data", "about");

const navCommandArb: fc.Arbitrary<NavCommand> = fc.oneof(
  {
    weight: 6,
    arbitrary: fc.constantFrom(1 as const, 2 as const).chain((originCommandId) =>
      fc.record({
        kind: fc.constant("responseReceived" as const),
        originCommandId: fc.constant(originCommandId),
        requestId: requestIdArb,
        loaderId: fc.oneof(
          originCommandId === 1 ? nav1LoaderArb : nav2LoaderArb,
          fc.constant(undefined),
        ),
        frameId: frameIdArb,
        type: resourceTypeArb,
        urlKind: urlKindArb,
        status: fc.constantFrom(200, 302, 404),
      }),
    ),
  },
  {
    weight: 4,
    arbitrary: fc.record({
      kind: fc.constant("responseReceivedExtraInfo" as const),
      requestId: requestIdArb,
      statusCode: fc.constantFrom(200, 302, 404),
      headerTag: fc.constantFrom("a", "b", "c"),
    }),
  },
  {
    weight: 4,
    arbitrary: fc.record({
      kind: fc.constant("loadingFinished" as const),
      requestId: requestIdArb,
    }),
  },
  {
    weight: 3,
    arbitrary: fc.record({
      kind: fc.constant("loadingFailed" as const),
      requestId: requestIdArb,
      errorText: fc.constantFrom("net::ERR_FAILED", "net::ERR_ABORTED"),
    }),
  },
  {
    weight: 3,
    arbitrary: fc.constantFrom(0 as const, 1 as const).chain((trackerIndex) =>
      fc.record({
        kind: fc.constant("setExpectedLoaderId" as const),
        trackerIndex: fc.constant(trackerIndex),
        loaderId: trackerIndex === 0 ? nav1LoaderArb : nav2LoaderArb,
      }),
    ),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant("expectWithoutLoader" as const),
      trackerIndex: fc.constantFrom(0 as const, 1 as const),
    }),
  },
  { weight: 2, arbitrary: fc.constant<NavCommand>({ kind: "startNewNavigation" }) },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant("swapMainFrame" as const),
      frameId: fc.constantFrom("main-frame", "main-frame-2"),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant("navigationCompleted" as const),
      trackerIndex: fc.constantFrom(0 as const, 1 as const),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant("dispose" as const),
      trackerIndex: fc.constantFrom(0 as const, 1 as const),
    }),
  },
);

function makeProtocolResponse(params: {
  url: string;
  protocol: string;
  status: number;
  headers: Record<string, string>;
}): Protocol.Network.Response {
  return {
    url: params.url,
    protocol: params.protocol,
    status: params.status,
    statusText: "OK",
    headers: params.headers,
    mimeType: "text/html",
    charset: "utf-8",
    connectionReused: false,
    connectionId: 1,
    encodedDataLength: 0,
    securityState: "secure",
  };
}

function buildUrl(kind: UrlKind, requestId: string): { url: string; protocol: string } {
  switch (kind) {
    case "http":
      return { url: `https://example.test/${requestId}`, protocol: "h2" };
    case "data":
      return { url: `data:text/html,<p>${requestId}</p>`, protocol: "data" };
    case "about":
      return { url: "about:blank", protocol: "about" };
    default: {
      const exhaustive: never = kind;
      throw new Error(`Unhandled urlKind: ${String(exhaustive)}`);
    }
  }
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  try {
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  }
});

describe("NavigationResponseTracker stateful properties", () => {
  it("never attributes stale, cross-navigation, subframe, or non-Document responses and leaks zero maps or listeners", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(navCommandArb, { minLength: 1, maxLength: 45 }),
        async (commands) => {
          const session = new MockSession();
          const page = new MockNavPage();
          const tracker0 = new NavigationResponseTracker({
            page: page as unknown as Page,
            session,
            navigationCommandId: 1,
          });
          let tracker1: NavigationResponseTracker | null = null;

          const getTracker = (index: 0 | 1): NavigationResponseTracker | null =>
            index === 0 ? tracker0 : tracker1;

          const resolvedState: Array<{ settled: boolean; value: Response | null }> = [
            { settled: false, value: null },
            { settled: false, value: null },
          ];
          void tracker0.response().then((val) => {
            resolvedState[0] = { settled: true, value: val };
          });

          const qualifyingByCommand = new Map<
            number,
            Array<{
              requestId: string;
              loaderId: string | undefined;
              url: string;
              isNonNetwork: boolean;
              activeCommandAtArrival: number;
            }>
          >();
          const recordQualifying = (
            originCommandId: number,
            entry: {
              requestId: string;
              loaderId: string | undefined;
              url: string;
              isNonNetwork: boolean;
              activeCommandAtArrival: number;
            },
          ) => {
            const list = qualifyingByCommand.get(originCommandId) ?? [];
            list.push(entry);
            qualifyingByCommand.set(originCommandId, list);
          };

          const createdResponses = new Set<Response>();
          const expectedLoaderByTracker: Array<string | undefined> = [undefined, undefined];

          try {
            for (const cmd of commands) {
              switch (cmd.kind) {
                case "responseReceived": {
                  // A navigation's response cannot arrive before that navigation starts.
                  if (cmd.originCommandId > page.latestCommandId) break;
                  const { url, protocol } = buildUrl(cmd.urlKind, cmd.requestId);
                  if (cmd.type === "Document" && cmd.frameId === page.currentMainFrameId) {
                    recordQualifying(cmd.originCommandId, {
                      requestId: cmd.requestId,
                      loaderId: cmd.loaderId,
                      url,
                      isNonNetwork: cmd.urlKind !== "http",
                      activeCommandAtArrival: page.latestCommandId,
                    });
                  }
                  session.emit("Network.responseReceived", {
                    requestId: cmd.requestId,
                    loaderId: cmd.loaderId ?? "",
                    frameId: cmd.frameId,
                    type: cmd.type,
                    timestamp: 1,
                    hasExtraInfo: false,
                    response: makeProtocolResponse({
                      url,
                      protocol,
                      status: cmd.status,
                      headers: { "x-origin": `status-${cmd.status}` },
                    }),
                  } satisfies Protocol.Network.ResponseReceivedEvent);
                  break;
                }
                case "responseReceivedExtraInfo": {
                  session.emit("Network.responseReceivedExtraInfo", {
                    requestId: cmd.requestId,
                    blockedCookies: [],
                    headers: { "x-extra": `${cmd.statusCode}-${cmd.headerTag}` },
                    resourceIPAddressSpace: "Public",
                    statusCode: cmd.statusCode,
                  } as Protocol.Network.ResponseReceivedExtraInfoEvent);
                  break;
                }
                case "loadingFinished": {
                  session.emit("Network.loadingFinished", {
                    requestId: cmd.requestId,
                    timestamp: 2,
                    encodedDataLength: 10,
                  } as Protocol.Network.LoadingFinishedEvent);
                  break;
                }
                case "loadingFailed": {
                  session.emit("Network.loadingFailed", {
                    requestId: cmd.requestId,
                    timestamp: 2,
                    type: "Document",
                    errorText: cmd.errorText,
                  } as Protocol.Network.LoadingFailedEvent);
                  break;
                }
                case "setExpectedLoaderId": {
                  const tracker = getTracker(cmd.trackerIndex);
                  if (tracker) {
                    if (!tracker.responseResolved) {
                      expectedLoaderByTracker[cmd.trackerIndex] = cmd.loaderId;
                    }
                    tracker.setExpectedLoaderId(cmd.loaderId);
                  }
                  break;
                }
                case "expectWithoutLoader": {
                  const tracker = getTracker(cmd.trackerIndex);
                  tracker?.expectNavigationWithoutKnownLoader();
                  break;
                }
                case "startNewNavigation": {
                  if (!tracker1) {
                    page.latestCommandId = 2;
                    tracker1 = new NavigationResponseTracker({
                      page: page as unknown as Page,
                      session,
                      navigationCommandId: 2,
                    });
                    void tracker1.response().then((val) => {
                      resolvedState[1] = { settled: true, value: val };
                    });
                  }
                  break;
                }
                case "swapMainFrame": {
                  page.currentMainFrameId = cmd.frameId;
                  break;
                }
                case "navigationCompleted": {
                  const tracker = getTracker(cmd.trackerIndex);
                  if (tracker) {
                    void tracker.navigationCompleted();
                    await Promise.resolve();
                  }
                  break;
                }
                case "dispose": {
                  const tracker = getTracker(cmd.trackerIndex);
                  tracker?.dispose();
                  break;
                }
                default: {
                  const exhaustive: never = cmd;
                  throw new Error(`Unhandled nav command: ${String(exhaustive)}`);
                }
              }

              await Promise.resolve();

              for (const idx of [0, 1] as const) {
                const tracker = getTracker(idx);
                if (!tracker) continue;

                if (tracker.selectedResponse) {
                  createdResponses.add(tracker.selectedResponse);
                }

                if (tracker.responseResolved) {
                  expect(tracker.pendingResponsesByLoader.size).toBe(0);
                  expect(tracker.pendingExtraInfo.size).toBe(0);
                }

                const resolved = resolvedState[idx]!;
                if (resolved.settled && resolved.value) {
                  const resp = resolved.value;
                  expect(resp.url().startsWith("data:")).toBe(false);
                  expect(resp.url().startsWith("about:")).toBe(false);

                  const expectedLoader = expectedLoaderByTracker[idx];
                  if (expectedLoader) {
                    expect(resp.loaderId).toBe(expectedLoader);
                    const originAllowed =
                      qualifyingByCommand.get(tracker.navigationCommandId) ?? [];
                    expect(
                      originAllowed.some(
                        (q) =>
                          !q.isNonNetwork &&
                          q.requestId === resp.requestId &&
                          q.url === resp.url() &&
                          q.loaderId === expectedLoader,
                      ),
                    ).toBe(true);
                  } else {
                    const arrivedWhileActive = [...qualifyingByCommand.values()]
                      .flat()
                      .filter((q) => q.activeCommandAtArrival === tracker.navigationCommandId);
                    expect(
                      arrivedWhileActive.some(
                        (q) =>
                          !q.isNonNetwork && q.requestId === resp.requestId && q.url === resp.url(),
                      ),
                    ).toBe(true);
                  }
                }
              }
            }

            tracker0.dispose();
            tracker1?.dispose();
            await tracker0.response();
            if (tracker1) await tracker1.response();

            expect(resolvedState[0]!.settled).toBe(true);
            if (tracker1) expect(resolvedState[1]!.settled).toBe(true);

            for (const resp of createdResponses) {
              resp.dispose();
            }
            expect(session.listenerCount()).toBe(0);
          } finally {
            tracker0.dispose();
            tracker1?.dispose();
            for (const resp of createdResponses) {
              resp.dispose();
            }
          }
        },
      ),
      { seed: 0x4e525401, numRuns: 200 },
    );
  });

  it("settles buffered response.finished() even when loadingFinished or loadingFailed arrives before setExpectedLoaderId", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        async (useFailure, extraBeforeResponse, useWithoutLoader) => {
          const session = new MockSession();
          const page = new MockNavPage();
          const tracker = new NavigationResponseTracker({
            page: page as unknown as Page,
            session,
            navigationCommandId: 1,
          });

          if (extraBeforeResponse) {
            session.emit("Network.responseReceivedExtraInfo", {
              requestId: "doc-req",
              blockedCookies: [],
              headers: { "set-cookie": "sid=abc", "content-type": "text/html" },
              resourceIPAddressSpace: "Public",
              statusCode: 200,
            } as Protocol.Network.ResponseReceivedExtraInfoEvent);
          }

          session.emit("Network.responseReceived", {
            requestId: "doc-req",
            loaderId: "loader-early",
            frameId: "main-frame",
            type: "Document",
            timestamp: 1,
            hasExtraInfo: true,
            response: makeProtocolResponse({
              url: "https://example.test/fast",
              protocol: "h2",
              status: 200,
              headers: { "content-type": "text/html" },
            }),
          } satisfies Protocol.Network.ResponseReceivedEvent);

          if (!extraBeforeResponse) {
            session.emit("Network.responseReceivedExtraInfo", {
              requestId: "doc-req",
              blockedCookies: [],
              headers: { "set-cookie": "sid=abc", "content-type": "text/html" },
              resourceIPAddressSpace: "Public",
              statusCode: 200,
            } as Protocol.Network.ResponseReceivedExtraInfoEvent);
          }

          if (useFailure) {
            session.emit("Network.loadingFailed", {
              requestId: "doc-req",
              timestamp: 2,
              type: "Document",
              errorText: "net::ERR_ABORTED",
            } as Protocol.Network.LoadingFailedEvent);
          } else {
            session.emit("Network.loadingFinished", {
              requestId: "doc-req",
              timestamp: 2,
              encodedDataLength: 42,
            } as Protocol.Network.LoadingFinishedEvent);
          }

          if (useWithoutLoader) {
            tracker.expectNavigationWithoutKnownLoader();
          } else {
            tracker.setExpectedLoaderId("loader-early");
          }

          const response = await tracker.navigationCompleted();
          expect(response).not.toBeNull();
          expect(response!.finishedSettled).toBe(true);
          const finished = await response!.finished();
          if (useFailure) {
            expect(finished).toBeInstanceOf(Error);
          } else {
            expect(finished).toBeNull();
          }
          expect(await response!.headerValue("set-cookie")).toBe("sid=abc");

          tracker.dispose();
          expect(session.listenerCount()).toBe(0);
        },
      ),
      { seed: 0x4e525402, numRuns: 50 },
    );
  });

  it("does not clobber a 200 final document response with a 302 redirect's stale extraInfo headers", async () => {
    await fc.assert(
      fc.asyncProperty(fc.boolean(), async (finalExtraArrivesAfter) => {
        const session = new MockSession();
        const page = new MockNavPage();
        const tracker = new NavigationResponseTracker({
          page: page as unknown as Page,
          session,
          navigationCommandId: 1,
        });
        tracker.setExpectedLoaderId("loader-redirect");

        session.emit("Network.responseReceivedExtraInfo", {
          requestId: "redirect-req",
          blockedCookies: [],
          headers: { location: "https://example.test/final", "x-hop": "redirect-302" },
          resourceIPAddressSpace: "Public",
          statusCode: 302,
        } as Protocol.Network.ResponseReceivedExtraInfoEvent);

        session.emit("Network.responseReceived", {
          requestId: "redirect-req",
          loaderId: "loader-redirect",
          frameId: "main-frame",
          type: "Document",
          timestamp: 1,
          hasExtraInfo: true,
          response: makeProtocolResponse({
            url: "https://example.test/final",
            protocol: "h2",
            status: 200,
            headers: { "x-final": "from-200" },
          }),
        } satisfies Protocol.Network.ResponseReceivedEvent);

        const response = await tracker.navigationCompleted();
        expect(response).not.toBeNull();
        expect(response!.headers()["x-hop"]).toBeUndefined();
        expect(response!.headers()["x-final"]).toBe("from-200");

        if (finalExtraArrivesAfter) {
          session.emit("Network.responseReceivedExtraInfo", {
            requestId: "redirect-req",
            blockedCookies: [],
            headers: { "x-final": "from-200-extra", "set-cookie": "ok=1" },
            resourceIPAddressSpace: "Public",
            statusCode: 200,
          } as Protocol.Network.ResponseReceivedExtraInfoEvent);
          expect(response!.headers()["x-final"]).toBe("from-200-extra");
          expect(await response!.headerValue("set-cookie")).toBe("ok=1");
        }

        response!.dispose();
        tracker.dispose();
        expect(session.listenerCount()).toBe(0);
      }),
      { seed: 0x4e525403, numRuns: 30 },
    );
  });

  it("preserves cached-revalidation 304 extraInfo headers on a 200 response while still rejecting 302 redirect extraInfo", async () => {
    for (const earlyArrival of [true, false]) {
      const session = new MockSession();
      const page = new MockNavPage();
      const tracker = new NavigationResponseTracker({
        page: page as unknown as Page,
        session,
        navigationCommandId: 1,
      });
      tracker.setExpectedLoaderId("loader-304");

      const emit304Extra = () => {
        session.emit("Network.responseReceivedExtraInfo", {
          requestId: "req-304",
          blockedCookies: [],
          headers: { etag: '"v1"', "x-revalidated": "304" },
          resourceIPAddressSpace: "Public",
          statusCode: 304,
        } as Protocol.Network.ResponseReceivedExtraInfoEvent);
      };

      if (earlyArrival) emit304Extra();

      session.emit("Network.responseReceived", {
        requestId: "req-304",
        loaderId: "loader-304",
        frameId: "main-frame",
        type: "Document",
        timestamp: 1,
        hasExtraInfo: true,
        response: makeProtocolResponse({
          url: "https://example.test/cached",
          protocol: "h2",
          status: 200,
          headers: { "x-base": "200" },
        }),
      } satisfies Protocol.Network.ResponseReceivedEvent);

      const response = await tracker.navigationCompleted();
      expect(response).not.toBeNull();
      if (!earlyArrival) emit304Extra();

      expect(response!.headers()["x-revalidated"]).toBe("304");
      expect(response!.headers()["etag"]).toBe('"v1"');

      // Stale 302 redirect metadata must still be ignored on the 200 response.
      session.emit("Network.responseReceivedExtraInfo", {
        requestId: "req-304",
        blockedCookies: [],
        headers: { location: "https://example.test/redirect", "x-revalidated": "stale-302" },
        resourceIPAddressSpace: "Public",
        statusCode: 302,
      } as Protocol.Network.ResponseReceivedExtraInfoEvent);
      expect(response!.headers()["x-revalidated"]).toBe("304");

      response!.dispose();
      tracker.dispose();
      expect(session.listenerCount()).toBe(0);
    }
  });

  it("accepts empty loaderId for fromServiceWorker responses when expectedLoaderId is set, while ignoring non-SW empty loaderId", async () => {
    const session = new MockSession();
    const page = new MockNavPage();
    const tracker = new NavigationResponseTracker({
      page: page as unknown as Page,
      session,
      navigationCommandId: 1,
    });
    tracker.setExpectedLoaderId("loader-expected");

    session.emit("Network.responseReceived", {
      requestId: "req-non-sw",
      loaderId: "",
      frameId: "main-frame",
      type: "Document",
      timestamp: 1,
      hasExtraInfo: false,
      response: {
        ...makeProtocolResponse({
          url: "https://example.test/stale-no-loader",
          protocol: "h2",
          status: 200,
          headers: {},
        }),
        fromServiceWorker: false,
      },
    } satisfies Protocol.Network.ResponseReceivedEvent);
    expect(tracker.responseResolved).toBe(false);

    session.emit("Network.responseReceived", {
      requestId: "req-sw",
      loaderId: "",
      frameId: "main-frame",
      type: "Document",
      timestamp: 2,
      hasExtraInfo: false,
      response: {
        ...makeProtocolResponse({
          url: "https://example.test/sw-doc",
          protocol: "h2",
          status: 200,
          headers: {},
        }),
        fromServiceWorker: true,
      },
    } satisfies Protocol.Network.ResponseReceivedEvent);

    const response = await tracker.navigationCompleted();
    expect(response).not.toBeNull();
    expect(response!.requestId).toBe("req-sw");
    expect(response!.fromServiceWorker()).toBe(true);

    response!.dispose();
    tracker.dispose();
    expect(session.listenerCount()).toBe(0);
  });
});
